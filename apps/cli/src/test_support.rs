use std::ffi::{OsStr, OsString};
use std::sync::{Mutex, OnceLock};

static SHARED_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn shared_env_lock() -> &'static Mutex<()> {
    SHARED_ENV_LOCK.get_or_init(|| Mutex::new(()))
}

/// Callers must hold shared_env_lock while the guard is alive.
pub(crate) struct ScopedEnv {
    name: &'static str,
    previous: Option<OsString>,
}

impl ScopedEnv {
    pub(crate) fn set(name: &'static str, value: impl AsRef<OsStr>) -> Self {
        let previous = std::env::var_os(name);
        unsafe {
            std::env::set_var(name, value);
        }
        Self { name, previous }
    }

    pub(crate) fn remove(name: &'static str) -> Self {
        let previous = std::env::var_os(name);
        unsafe {
            std::env::remove_var(name);
        }
        Self { name, previous }
    }
}

impl Drop for ScopedEnv {
    fn drop(&mut self) {
        unsafe {
            match &self.previous {
                Some(value) => std::env::set_var(self.name, value),
                None => std::env::remove_var(self.name),
            }
        }
    }
}
