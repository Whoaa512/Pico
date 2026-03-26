use crate::config;
use crate::terminal::{prompt_input, prompt_password};

fn get_system_username() -> String {
    #[cfg(unix)]
    {
        std::env::var("USER")
            .or_else(|_| {
                std::process::Command::new("whoami")
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|s| s.trim().to_string())
                    .ok_or(std::env::VarError::NotPresent)
            })
            .unwrap_or_else(|_| "admin".to_string())
    }

    #[cfg(windows)]
    {
        std::env::var("USERNAME")
            .or_else(|_| {
                std::process::Command::new("cmd")
                    .args(["/C", "whoami"])
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|s| {
                        let trimmed = s.trim();
                        trimmed
                            .rsplit('\\')
                            .next()
                            .unwrap_or(trimmed)
                            .to_string()
                    })
                    .ok_or(std::env::VarError::NotPresent)
            })
            .unwrap_or_else(|_| "admin".to_string())
    }

    #[cfg(not(any(unix, windows)))]
    {
        "admin".to_string()
    }
}

pub fn run_init() -> anyhow::Result<()> {
    let config_path = std::path::PathBuf::from("config.toml");

    if config_path.exists() {
        eprintln!("config.toml already exists. Remove it first if you want to reinitialize.");
        std::process::exit(1);
    }

    println!("=== pi-server init ===");
    println!();

    let default_username = get_system_username();
    let username = prompt_input(&format!("Username [{}]: ", default_username))
        .unwrap_or(default_username);

    let password = prompt_password("Password: ");
    if password.is_empty() {
        eprintln!("Password cannot be empty.");
        std::process::exit(1);
    }

    let confirm = prompt_password("Confirm password: ");
    if password != confirm {
        eprintln!("Passwords do not match.");
        std::process::exit(1);
    }

    let host = prompt_input("Host [0.0.0.0]: ").unwrap_or_else(|| "0.0.0.0".to_string());

    let port: u16 = prompt_input("Port [5454]: ")
        .and_then(|s| s.parse().ok())
        .unwrap_or(5454);

    let hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)?;

    let config = config::AppConfig {
        server: config::ServerConfig {
            port,
            host,
            server_id: Some(uuid::Uuid::new_v4().to_string()),
            remote: false,
        },
        auth: config::AuthConfig {
            username,
            password_hash: hash,
            access_token_ttl_minutes: 15,
            refresh_token_ttl_days: 30,
            session_ttl_hours: None,
        },
        package: config::PackageConfig {
            name: "@mariozechner/pi-coding-agent".to_string(),
            install_command: None,
        },
        sessions: None,
        agent: None,
        chat: None,
    };

    let toml_str = toml::to_string_pretty(&config)?;
    std::fs::write(&config_path, &toml_str)?;

    println!();
    println!("config.toml created successfully.");
    println!("Run: ./pi-server");

    Ok(())
}
