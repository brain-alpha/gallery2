//! Civitai 站点图片数据源。
//! 负责通过官方 Site API 拉取远程图片，并转换为前端复用的图库记录。

use crate::shared::models::{CivitaiImagePage, ImageRecord};
use reqwest::StatusCode;
use serde::Deserialize;

const CIVITAI_IMAGES_ENDPOINT: &str = "https://civitai.com/api/v1/images";
const CIVITAI_BROWSING_LEVEL_SFW: &str = "1";

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
    cursor: Option<String>,
    limit: i64,
) -> Result<CivitaiImagePage, String> {
    let limit = limit.clamp(1, 200);
    let mut url = format!(
        "{CIVITAI_IMAGES_ENDPOINT}?limit={limit}&type=image&sort=Newest&browsingLevel={CIVITAI_BROWSING_LEVEL_SFW}"
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
    let items = page
        .items
        .into_iter()
        .filter_map(civitai_record_from_item)
        .collect::<Vec<_>>();

    Ok(CivitaiImagePage {
        items,
        next_cursor: page.metadata.and_then(|metadata| metadata.next_cursor),
    })
}

fn normalized_cursor(cursor: Option<String>) -> Option<String> {
    cursor
        .map(|cursor| cursor.trim().to_string())
        .filter(|cursor| !cursor.is_empty())
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

fn civitai_record_from_item(item: CivitaiImageItem) -> Option<ImageRecord> {
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
        media_type,
        width: item.width.unwrap_or(1).max(1),
        height: item.height.unwrap_or(1).max(1),
        modified: item.id,
        size: 0,
    })
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
