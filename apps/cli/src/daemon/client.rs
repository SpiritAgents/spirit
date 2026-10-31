//! JSON-RPC 2.0 client over the daemon WebSocket. Mirrors the bridge
//! process model: a reader thread feeds an mpsc channel; the caller drives
//! `call` (request/response) and drains server-initiated notifications.

use anyhow::{Context, Result, anyhow};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver},
    },
    thread,
    time::Duration,
};

use super::resolve::is_loopback_host;
use super::ws::{WsReadEvent, WsStream};

pub(super) fn validate_product_build(health: &Value) -> Result<()> {
    let actual = health.get("productBuildId").and_then(Value::as_str);
    if actual != Some(crate::product::PRODUCT_BUILD_ID) {
        return Err(anyhow!(
            "{} client requires product build {} ({}), but the daemon reported {}. Use matching client and daemon builds.",
            crate::product::NAME,
            crate::product::PRODUCT_BUILD_ID,
            crate::product::QUALITY,
            actual.unwrap_or("no product build identity"),
        ));
    }
    Ok(())
}

pub(crate) struct DaemonClient {
    writer: Arc<Mutex<WsStream>>,
    rx: Receiver<Result<Value>>,
    next_id: u64,
    /// Server-initiated notifications buffered while waiting for responses.
    notifications: VecDeque<Value>,
}

impl DaemonClient {
    pub(crate) fn connect(host: &str, port: u16, token: &str) -> Result<Self> {
        if !is_loopback_host(host) {
            return Err(anyhow!("daemon host must be loopback: {host}"));
        }
        let stream = WsStream::connect(host, port, "/", Some(token))?;
        let mut reader = stream.try_clone()?;
        let writer = Arc::new(Mutex::new(stream));

        let (tx, rx) = mpsc::channel::<Result<Value>>();
        let writer_for_reader = Arc::clone(&writer);
        thread::spawn(move || {
            loop {
                match reader.read_event() {
                    Ok(WsReadEvent::Text(text)) => {
                        let parsed = serde_json::from_str::<Value>(&text)
                            .with_context(|| "parse daemon JSON-RPC frame");
                        if tx.send(parsed).is_err() {
                            break;
                        }
                    }
                    Ok(WsReadEvent::Binary) => {}
                    Ok(WsReadEvent::Closed) => {
                        let _ = writer_for_reader
                            .lock()
                            .ok()
                            .map(|mut locked| locked.send_close());
                        let _ = tx.send(Err(anyhow!("daemon closed the connection")));
                        break;
                    }
                    Err(err) => {
                        let _ = tx.send(Err(err));
                        break;
                    }
                }
            }
        });

        Ok(Self {
            writer,
            rx,
            next_id: 1,
            notifications: VecDeque::new(),
        })
    }

    pub(crate) fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.writer
            .lock()
            .map_err(|_| anyhow!("daemon writer poisoned"))?
            .send_text(&request.to_string())?;

        loop {
            let message = self
                .rx
                .recv()
                .map_err(|_| anyhow!("daemon reader thread ended"))??;
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                if let Some(error) = message.get("error") {
                    let text = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown daemon error");
                    return Err(anyhow!("{text}"));
                }
                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }
            // A notification or a stale response: keep it for the event loop.
            self.notifications.push_back(message);
        }
    }

    /// Blocks for the next server notification, with a timeout so callers can
    /// re-check deadlines. Returns None on timeout.
    pub(crate) fn next_notification(&mut self, timeout: Duration) -> Result<Option<Value>> {
        if let Some(value) = self.notifications.pop_front() {
            return Ok(Some(value));
        }
        match self.rx.recv_timeout(timeout) {
            Ok(message) => {
                let message = message?;
                if message.get("method").is_some() {
                    return Ok(Some(message));
                }
                // Responses with no matching call should not happen; drop.
                Ok(None)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(anyhow!("daemon reader thread ended")),
        }
    }

    pub(crate) fn close(&mut self) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writer.send_close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_handshake_accepts_only_the_baked_build() {
        assert!(
            validate_product_build(&json!({
                "productBuildId": crate::product::PRODUCT_BUILD_ID
            }))
            .is_ok()
        );
        for health in [
            json!({"productBuildId": "different-product-build"}),
            json!({"productBuildId": null}),
            json!({}),
            Value::Null,
        ] {
            let error = validate_product_build(&health).unwrap_err().to_string();
            assert!(error.contains("Use matching client and daemon builds"));
        }
    }
}
