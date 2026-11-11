#[cfg(unix)]
#[test]
fn daemon_backed_config_and_chat_repository_roundtrip() {
    use spirit::{
        adapters::{JsonChatRepository, JsonConfigStore},
        ports::{ChatArchive, ChatRepository, ConfigStore},
        rewind::conversation_snapshots,
        view::{ChatMessage, MessageRole},
    };
    use std::{fs, process::Command};

    let root = std::env::temp_dir().join(format!("spirit-daemon-adapters-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create isolated daemon data dir");
    unsafe {
        std::env::set_var("SPIRIT_DATA_DIR", &root);
        std::env::set_var("SPIRIT_SERVER_DATA_DIR", &root);
    }

    let config = JsonConfigStore.load().expect("load config through daemon");
    assert_eq!(config.schema_version, 1);

    let repository = JsonChatRepository;
    let archive = ChatArchive {
        messages: vec![("user".to_string(), "hello".to_string())],
        assistant_aux: Vec::new(),
        llm_history: Vec::new(),
        loop_enabled: false,
        approval_level: "default".to_string(),
        subagent_sessions: Vec::new(),
        desktop_messages: Some(conversation_snapshots(
            &[ChatMessage::new(MessageRole::User, "hello")],
            &Default::default(),
            None,
        )),
        rewind: None,
        session_display_name: Some("Fixture".to_string()),
        session_title_source: Some("seed".to_string()),
    };
    let path = repository
        .save(None, &archive)
        .expect("save through daemon");
    let loaded = repository
        .load(path.to_string_lossy().as_ref())
        .expect("load through daemon");
    assert_eq!(loaded.messages, archive.messages);
    assert_eq!(loaded.session_display_name, archive.session_display_name);
    assert!(
        repository
            .list()
            .expect("list stored sessions")
            .iter()
            .any(|entry| entry.path == path.to_string_lossy())
    );

    if let Ok(entries) = fs::read_dir(root.join("server/instances")) {
        for entry in entries.flatten() {
            if let Ok(raw) = fs::read_to_string(entry.path())
                && let Ok(instance) = serde_json::from_str::<serde_json::Value>(&raw)
                && let Some(pid) = instance.get("pid").and_then(serde_json::Value::as_u64)
            {
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status();
            }
        }
    }
    let _ = fs::remove_dir_all(root);
}
