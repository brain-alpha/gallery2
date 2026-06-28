//! Civitai 站点图片数据源。
//! 负责通过官方 Site API 拉取远程图片，并转换为前端复用的图库记录。

use crate::{
    shared::{
        models::{CivitaiFavoriteResult, CivitaiImagePage, ImageRecord},
        path_utils::user_path_string,
    },
    storage::{
        asset_scope::allow_asset_directory, config::configured_generated_content_dir, db::open_db,
    },
};
use reqwest::{header::CONTENT_TYPE, StatusCode};
use serde::Deserialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

const CIVITAI_IMAGES_ENDPOINT: &str = "https://civitai.com/api/v1/images";
const CIVITAI_PERIOD: &str = "Month";
const CIVITAI_SORT: &str = "Most Reactions";
const CIVITAI_BROWSING_LEVEL_SAFE_AND_SOFT: &str = "3";
const CIVITAI_FAVORITES_DIR_NAME: &str = "civitai-favorites";
const CIVITAI_FAVORITE_FILE_PREFIX: &str = "civitai";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CivitaiImagesResponse {
    items: Vec<CivitaiImageItem>,
    metadata: Option<CivitaiPageMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CivitaiImageItem {
    id: i64,
    url: String,
    hash: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    #[serde(rename = "type")]
    media_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CivitaiPageMetadata {
    next_cursor: Option<String>,
}

pub(crate) async fn list_images(
    app: tauri::AppHandle,
    cursor: Option<String>,
    limit: i64,
    period: Option<String>,
    sort: Option<String>,
    browsing_level: Option<i64>,
) -> Result<CivitaiImagePage, String> {
    let limit = limit.clamp(1, 200);
    let period = normalized_period(period);
    let sort = normalized_sort(sort);
    let browsing_level = normalized_browsing_level(browsing_level);
    let mut url = format!(
        "{CIVITAI_IMAGES_ENDPOINT}?limit={limit}&type=image&period={}&sort={}&browsingLevel={}",
        encode_query_value(period),
        encode_query_value(sort),
        encode_query_value(&browsing_level),
    );
    if let Some(cursor) = normalized_cursor(cursor) {
        url.push_str("&cursor=");
        url.push_str(&encode_query_value(&cursor));
    }

    let response = reqwest::Client::new()
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", "Gallery")
        .send()
        .await
        .map_err(|err| format!("Civitai request failed: {err}"))?;
    let status = response.status();
    let body = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read Civitai response: {err}"))?;
    if !status.is_success() {
        return Err(format_civitai_http_error(status, &body));
    }

    let page = serde_json::from_slice::<CivitaiImagesResponse>(&body).map_err(|err| {
        format!(
            "Failed to parse Civitai response: {err}: {}",
            String::from_utf8_lossy(&body)
        )
    })?;
    let favorite_ids = existing_favorite_ids(&civitai_favorites_dir(&app)?);
    let items = page
        .items
        .into_iter()
        .filter_map(|item| civitai_record_from_item(item, &favorite_ids))
        .collect::<Vec<_>>();

    Ok(CivitaiImagePage {
        items,
        next_cursor: page.metadata.and_then(|metadata| metadata.next_cursor),
    })
}

pub(crate) async fn favorite_image(
    app: tauri::AppHandle,
    image_id: i64,
    url: String,
) -> Result<CivitaiFavoriteResult, String> {
    if image_id <= 0 {
        return Err("Civitai image id 无效".to_string());
    }
    validate_civitai_image_url(&url)?;

    let favorite_dir = civitai_favorites_dir(&app)?;
    fs::create_dir_all(&favorite_dir)
        .map_err(|err| format!("Failed to create Civitai favorites directory: {err}"))?;
    allow_asset_directory(&app.asset_protocol_scope(), &favorite_dir)?;

    if let Some(path) = existing_favorite_path(&favorite_dir, image_id) {
        return Ok(CivitaiFavoriteResult {
            path: user_path_string(&path),
            already_favorited: true,
        });
    }

    let downloaded = download_civitai_image(&url).await?;
    let extension = downloaded
        .content_type
        .as_deref()
        .and_then(image_extension_from_content_type)
        .or_else(|| image_extension_from_url(&url))
        .unwrap_or("jpg");
    let target = favorite_dir.join(format!(
        "{CIVITAI_FAVORITE_FILE_PREFIX}-{image_id}.{extension}"
    ));
    fs::write(&target, &downloaded.bytes)
        .map_err(|err| format!("Failed to save Civitai favorite image: {err}"))?;

    Ok(CivitaiFavoriteResult {
        path: user_path_string(&target),
        already_favorited: false,
    })
}

pub(crate) fn unfavorite_image(app: tauri::AppHandle, image_id: i64) -> Result<(), String> {
    if image_id <= 0 {
        return Err("Civitai image id 无效".to_string());
    }

    let favorite_dir = civitai_favorites_dir(&app)?;
    let Some(path) = existing_favorite_path(&favorite_dir, image_id) else {
        return Ok(());
    };
    fs::remove_file(&path).map_err(|err| format!("Failed to remove Civitai favorite image: {err}"))
}

fn normalized_cursor(cursor: Option<String>) -> Option<String> {
    cursor
        .map(|cursor| cursor.trim().to_string())
        .filter(|cursor| !cursor.is_empty())
}

fn normalized_period(period: Option<String>) -> &'static str {
    match period.as_deref().map(str::trim) {
        Some("AllTime") => "AllTime",
        Some("Year") => "Year",
        Some("Week") => "Week",
        Some("Day") => "Day",
        Some("Month") | _ => CIVITAI_PERIOD,
    }
}

fn normalized_sort(sort: Option<String>) -> &'static str {
    match sort.as_deref().map(str::trim) {
        Some("Most Comments") => "Most Comments",
        Some("Most Collected") => "Most Collected",
        Some("Newest") => "Newest",
        Some("Oldest") => "Oldest",
        Some("Most Reactions") | _ => CIVITAI_SORT,
    }
}

fn normalized_browsing_level(browsing_level: Option<i64>) -> String {
    match browsing_level {
        Some(level) if (1..=31).contains(&level) => level.to_string(),
        _ => CIVITAI_BROWSING_LEVEL_SAFE_AND_SOFT.to_string(),
    }
}

fn encode_query_value(value: &str) -> String {
    value.bytes().fold(String::new(), |mut encoded, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
        encoded
    })
}

fn civitai_record_from_item(
    item: CivitaiImageItem,
    favorite_ids: &HashSet<i64>,
) -> Option<ImageRecord> {
    let url = item.url.trim();
    if url.is_empty() {
        return None;
    }

    let media_type = item.media_type.unwrap_or_else(|| "image".to_string());
    if media_type != "image" {
        return None;
    }

    Some(ImageRecord {
        path: url.to_string(),
        display_path: url.to_string(),
        blur_hash: normalized_blur_hash(item.hash),
        favorited: favorite_ids.contains(&item.id),
        media_type,
        width: item.width.unwrap_or(1).max(1),
        height: item.height.unwrap_or(1).max(1),
        modified: item.id,
        size: 0,
    })
}

fn existing_favorite_ids(favorite_dir: &Path) -> HashSet<i64> {
    fs::read_dir(favorite_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| favorite_id_from_path(&entry.path()))
        .collect()
}

fn favorite_id_from_path(path: &Path) -> Option<i64> {
    let name = path.file_name()?.to_str()?;
    let rest = name.strip_prefix(&format!("{CIVITAI_FAVORITE_FILE_PREFIX}-"))?;
    let id = rest.split('.').next()?.parse::<i64>().ok()?;
    (id > 0).then_some(id)
}

struct DownloadedImage {
    bytes: Vec<u8>,
    content_type: Option<String>,
}

async fn download_civitai_image(url: &str) -> Result<DownloadedImage, String> {
    let response = reqwest::Client::new()
        .get(url)
        .header("Accept", "image/*")
        .header("User-Agent", "Gallery")
        .send()
        .await
        .map_err(|err| format!("Civitai 图片下载失败：{err}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取 Civitai 图片失败：{err}"))?;
    if !status.is_success() {
        return Err(format_civitai_http_error(status, &bytes));
    }
    if !content_type
        .as_deref()
        .is_some_and(|value| value.starts_with("image/"))
    {
        return Err("Civitai 收藏下载结果不是图片".to_string());
    }
    Ok(DownloadedImage {
        bytes: bytes.to_vec(),
        content_type,
    })
}

fn civitai_favorites_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let conn = open_db(app)?;
    Ok(configured_generated_content_dir(app, &conn)?.join(CIVITAI_FAVORITES_DIR_NAME))
}

fn existing_favorite_path(favorite_dir: &Path, image_id: i64) -> Option<PathBuf> {
    let prefix = format!("{CIVITAI_FAVORITE_FILE_PREFIX}-{image_id}.");
    fs::read_dir(favorite_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix))
        })
}

fn validate_civitai_image_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Civitai 图片地址无效".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if parsed.scheme() != "https" || !matches!(host, "image.civitai.com" | "image-b2.civitai.com") {
        return Err("只允许收藏 Civitai 图片地址".to_string());
    }
    Ok(())
}

fn image_extension_from_content_type(content_type: &str) -> Option<&'static str> {
    match content_type
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn image_extension_from_url(url: &str) -> Option<&'static str> {
    let extension = reqwest::Url::parse(url).ok().and_then(|parsed| {
        Path::new(parsed.path())
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
    })?;
    match extension.as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        _ => None,
    }
}

fn normalized_blur_hash(hash: Option<String>) -> Option<String> {
    hash.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn format_civitai_http_error(status: StatusCode, body: &[u8]) -> String {
    let payload = serde_json::from_slice::<serde_json::Value>(body).ok();
    let detail = payload
        .as_ref()
        .and_then(|value| first_json_string(value, &["/message", "/error", "/error/message"]))
        .unwrap_or_else(|| String::from_utf8_lossy(body).trim().to_string());

    match status.as_u16() {
        400 => format!("Civitai 请求参数无效：{detail}"),
        401 | 403 => "Civitai 请求未授权".to_string(),
        408 => "Civitai 请求超时，请稍后重试".to_string(),
        429 => "Civitai 请求过于频繁，请稍后重试".to_string(),
        500..=599 => "Civitai 服务暂时不可用，请稍后重试".to_string(),
        _ => format!("Civitai 请求失败（HTTP {status}）：{detail}"),
    }
}

fn first_json_string(value: &serde_json::Value, pointers: &[&str]) -> Option<String> {
    pointers.iter().find_map(|pointer| {
        value
            .pointer(pointer)
            .and_then(|entry| entry.as_str())
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
    })
}
