use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::vanity::Wallet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredWallet {
    pub id: Uuid,
    pub address: String,
    pub encrypted_private_key: String,
    pub nonce: String,
    pub salt: String,
    pub tag: String,
    pub label: Option<String>,
    pub created_at: u64,
    pub source_task_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WalletVault {
    pub version: u32,
    pub wallets: Vec<StoredWallet>,
    pub master_salt: Option<String>,
    pub master_verifier: Option<MasterPasswordVerifier>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterPasswordVerifier {
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone)]
pub struct DerivedKey {
    pub key: [u8; 32],
    pub salt: Vec<u8>,
}

pub struct WalletStore {
    path: PathBuf,
    cache: Mutex<Option<WalletVault>>,
    attempt_counter: Mutex<AttemptTracker>,
}

#[derive(Debug, Clone)]
pub struct AttemptTracker {
    pub failed_since_success: u32,
    pub cooldown_until_epoch: u64,
    pub last_result_ok: bool,
}
impl Default for AttemptTracker {
    fn default() -> Self {
        Self {
            failed_since_success: 0,
            cooldown_until_epoch: 0,
            last_result_ok: false,
        }
    }
}

impl WalletStore {
    pub fn new(app_data_dir: &Path) -> Self {
        std::fs::create_dir_all(app_data_dir).ok();
        Self {
            path: app_data_dir.join("wallets.vault.json"),
            cache: Mutex::new(None),
            attempt_counter: Mutex::new(AttemptTracker::default()),
        }
    }

    const MAX_ATTEMPTS_BEFORE_COOLDOWN: u32 = 5;
    const COOLDOWN_SECONDS: u64 = 30;
    const MASTER_VERIFIER_PLAINTEXT: &'static [u8] = b"eth-vanity-wallet-master-password-v1";

    pub fn attempt_status(&self) -> (u32, u64) {
        let tracker = self.attempt_counter.lock();
        let now = epoch_sec();
        let remain_until_cd =
            Self::MAX_ATTEMPTS_BEFORE_COOLDOWN.saturating_sub(tracker.failed_since_success);
        let cd_secs = tracker
            .cooldown_until_epoch
            .saturating_sub(now);
        // 错误次数已达阈值但冷却还在 → 剩余次数按 0 展示
        if cd_secs > 0 {
            (0, cd_secs)
        } else {
            (remain_until_cd.min(Self::MAX_ATTEMPTS_BEFORE_COOLDOWN), 0)
        }
    }

    fn register_verify_result(&self, ok: bool) {
        let mut t = self.attempt_counter.lock();
        t.last_result_ok = ok;
        if ok {
            t.failed_since_success = 0;
            t.cooldown_until_epoch = 0;
        } else {
            t.failed_since_success = t.failed_since_success.saturating_add(1);
            if t.failed_since_success >= Self::MAX_ATTEMPTS_BEFORE_COOLDOWN {
                t.cooldown_until_epoch = epoch_sec().saturating_add(Self::COOLDOWN_SECONDS);
            }
        }
    }

    fn verify_cooldown(&self) -> Result<(), String> {
        let (_, cd) = self.attempt_status();
        if cd > 0 {
            return Err(format!(
                "错误次数过多，请等待 {} 秒后重试",
                cd
            ));
        }
        Ok(())
    }

    pub fn is_initialized(&self) -> bool {
        self.path.exists()
    }

    /// 重置钱包库：删除 wallets.vault.json 文件（所有已保存钱包 + 主密码彻底清空）+ 清缓存 + 重置尝试计数/冷却
    pub fn reset(&self) -> Result<(), String> {
        if self.path.exists() {
            std::fs::remove_file(&self.path).map_err(|e| e.to_string())?;
        }
        *self.cache.lock() = None;
        *self.attempt_counter.lock() = AttemptTracker::default();
        Ok(())
    }

    fn read_vault(&self) -> WalletVault {
        if let Some(cached) = self.cache.lock().clone() {
            return cached;
        }
        let vault = if self.path.exists() {
            let s = std::fs::read_to_string(&self.path).unwrap_or_default();
            serde_json::from_str::<WalletVault>(&s).unwrap_or_default()
        } else {
            WalletVault {
                version: 2,
                wallets: Vec::new(),
                master_salt: None,
                master_verifier: None,
            }
        };
        *self.cache.lock() = Some(vault.clone());
        vault
    }

    fn write_vault(&self, vault: &WalletVault) -> Result<(), String> {
        let s = serde_json::to_string_pretty(vault).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, s).map_err(|e| e.to_string())?;
        *self.cache.lock() = Some(vault.clone());
        Ok(())
    }

    pub fn init_master_password(&self, password: &str) -> Result<(), String> {
        if let Err(e) = validate_password_format(password) {
            return Err(e.to_string());
        }
        let mut vault = self.read_vault();
        if vault.master_salt.is_some() {
            return Err("已设置主密码，请使用修改主密码功能。".to_string());
        }
        let mut salt = vec![0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let derived = self.derive_key(password, &salt)?;
        let verifier = Self::build_master_verifier(&derived.key)?;
        vault.version = 2;
        vault.master_salt = Some(hex::encode(salt));
        vault.master_verifier = Some(verifier);
        self.write_vault(&vault)?;
        // 初始化成功，重置尝试计数
        self.register_verify_result(true);
        Ok(())
    }

    pub fn verify_password(&self, password: &str) -> Result<(), String> {
        self.verify_cooldown()?;
        // 为了不区分"格式错误"和"密码错误"的攻击面，
        // 校验格式不合规时也按一次失败 attempt + 返回统一脱敏的错误。
        let format_ok = validate_password_format(password).is_ok();
        let vault = self.read_vault();
        let result = match vault.master_salt {
            Some(ref hex_salt) => {
                if !format_ok {
                    Err("主密码错误".to_string())
                } else {
                    let salt: Vec<u8> = hex::decode(hex_salt)
                        .map_err(|_| "主密码校验失败".to_string())?;
                    let derived = self.derive_key(password, &salt)?;
                    Self::verify_master_key(&vault, password, &derived.key)
                }
            }
            None => Err("尚未设置主密码".to_string()),
        };
        let ok = result.is_ok();
        self.register_verify_result(ok);
        if ok && vault.master_verifier.is_none() {
            if let Ok(mut migrated) = self.try_migrate_master_verifier(password) {
                migrated.version = 2;
                let _ = self.write_vault(&migrated);
            }
        }
        if ok {
            Ok(())
        } else {
            Err(result.err().unwrap_or_else(|| "主密码错误".to_string()))
        }
    }

    pub fn change_master_password(&self, old: &str, new: &str) -> Result<(), String> {
        self.verify_cooldown()?;
        if let Err(e) = validate_password_format(new) {
            return Err(e.to_string());
        }
        if old == new {
            return Err("新主密码与当前密码相同，未作修改。".to_string());
        }
        let mut vault = self.read_vault();
        let old_salt_hex = vault
            .master_salt
            .clone()
            .ok_or_else(|| "尚未设置主密码".to_string())?;
        let old_salt: Vec<u8> = hex::decode(&old_salt_hex)
            .map_err(|_| "主密码校验失败".to_string())?;
        let old_derived = self
            .derive_key(old, &old_salt)
            .map_err(|_| "当前主密码错误".to_string())?;
        if let Err(e) = Self::verify_master_key(&vault, old, &old_derived.key) {
            self.register_verify_result(false);
            return Err(if e.contains("缺少密码校验信息") {
                e
            } else {
                "当前主密码错误".to_string()
            });
        }

        // 先验证旧密码通过，再用新密码重新 derive 新盐，然后逐个钱包重加密
        let mut new_salt = vec![0u8; 16];
        rand::thread_rng().fill_bytes(&mut new_salt);
        let new_derived = self.derive_key(new, &new_salt)?;

        for w in vault.wallets.iter_mut() {
            // 解密旧密文
            let stored_salt: Vec<u8> = hex::decode(&w.salt)
                .map_err(|_| "主盐损坏，无法重加密".to_string())?;
            // 注意：每个钱包有自己独立的 salt（用于 derive per-wallet key）
            let wallet_derived_old = self
                .derive_key(old, &stored_salt)
                .map_err(|_| "当前主密码错误".to_string())?;
            let nonce_bytes: Vec<u8> = hex::decode(&w.nonce)
                .map_err(|_| "钱包 nonce 损坏".to_string())?;
            let ciphertext: Vec<u8> = hex::decode(&w.encrypted_private_key)
                .map_err(|_| "钱包密文损坏".to_string())?;
            let cipher_old = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&wallet_derived_old.key));
            let nonce_old = Nonce::from_slice(&nonce_bytes);
            let pk_bytes = cipher_old
                .decrypt(nonce_old, ciphertext.as_ref())
                .map_err(|_| "当前主密码错误".to_string())?;

            // 生成新的 per-wallet salt + nonce，用新主密码派生新 key 加密
            let mut w_salt_new = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut w_salt_new);
            let w_derived_new = self.derive_key(new, &w_salt_new)?;
            let mut w_nonce_new = [0u8; 12];
            rand::thread_rng().fill_bytes(&mut w_nonce_new);
            let cipher_new =
                Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&w_derived_new.key));
            let ct_new = cipher_new
                .encrypt(Nonce::from_slice(&w_nonce_new), pk_bytes.as_ref())
                .map_err(|_| "重加密失败".to_string())?;
            w.salt = hex::encode(w_salt_new);
            w.nonce = hex::encode(w_nonce_new);
            w.encrypted_private_key = hex::encode(&ct_new);
            w.tag = String::new();
        }

        vault.master_salt = Some(hex::encode(new_salt));
        vault.master_verifier = Some(Self::build_master_verifier(&new_derived.key)?);
        vault.version = 2;
        self.write_vault(&vault)?;
        // 改密成功，重置尝试计数
        self.register_verify_result(true);
        Ok(())
    }

    pub fn list_wallets_meta(&self) -> Vec<StoredWallet> {
        let mut vault = self.read_vault();
        for w in vault.wallets.iter_mut() {
            w.encrypted_private_key = String::new();
            w.nonce = String::new();
            w.salt = String::new();
            w.tag = String::new();
        }
        vault.wallets
    }

    pub fn save_wallet(
        &self,
        wallet: &Wallet,
        password: &str,
        label: Option<String>,
        source_task_id: Option<Uuid>,
    ) -> Result<Uuid, String> {
        self.verify_password(password)?;
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let derived = self.derive_key(password, &salt)?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derived.key));
        let ciphertext = cipher
            .encrypt(nonce, wallet.private_key.as_bytes())
            .map_err(|e| format!("加密失败: {}", e))?;
        let id = Uuid::new_v4();
        let stored = StoredWallet {
            id,
            address: wallet.address.clone(),
            encrypted_private_key: hex::encode(&ciphertext),
            nonce: hex::encode(nonce_bytes),
            salt: hex::encode(salt),
            tag: String::new(),
            label,
            created_at: epoch_sec(),
            source_task_id,
        };
        let mut vault = self.read_vault();
        vault.wallets.push(stored);
        self.write_vault(&vault)?;
        Ok(id)
    }

    pub fn decrypt_wallet(&self, id: Uuid, password: &str) -> Result<Wallet, String> {
        let vault = self.read_vault();
        let stored = vault
            .wallets
            .iter()
            .find(|w| w.id == id)
            .ok_or("钱包不存在")?;
        let salt = hex::decode(&stored.salt).map_err(|_| "salt 损坏")?;
        let nonce_bytes = hex::decode(&stored.nonce).map_err(|_| "nonce 损坏")?;
        let ciphertext = hex::decode(&stored.encrypted_private_key).map_err(|_| "密文损坏")?;
        let derived = self.derive_key(password, &salt)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derived.key));
        let nonce = Nonce::from_slice(&nonce_bytes);
        let pk_bytes = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|_| "解密失败，请检查密码")?;
        let pk = String::from_utf8(pk_bytes).map_err(|_| "解密结果非 UTF-8")?;
        Ok(Wallet {
            address: stored.address.clone(),
            private_key: pk,
        })
    }

    pub fn remove_wallet(&self, id: Uuid) -> Result<(), String> {
        let mut vault = self.read_vault();
        let before = vault.wallets.len();
        vault.wallets.retain(|w| w.id != id);
        if vault.wallets.len() == before {
            return Err("钱包不存在".into());
        }
        self.write_vault(&vault)?;
        Ok(())
    }

    pub fn export_plain_private_key(&self, id: Uuid, password: &str) -> Result<String, String> {
        let w = self.decrypt_wallet(id, password)?;
        Ok(w.private_key)
    }

    fn derive_key(&self, password: &str, salt: &[u8]) -> Result<DerivedKey, String> {
        let params = Params::new(64 * 1024, 3, 1, Some(32))
            .map_err(|e| format!("Argon2 参数错误: {}", e))?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = [0u8; 32];
        argon
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|e| format!("密钥派生失败: {}", e))?;
        Ok(DerivedKey {
            key,
            salt: salt.to_vec(),
        })
    }

    fn build_master_verifier(key: &[u8; 32]) -> Result<MasterPasswordVerifier, String> {
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Self::MASTER_VERIFIER_PLAINTEXT,
            )
            .map_err(|_| "主密码校验器生成失败".to_string())?;
        Ok(MasterPasswordVerifier {
            nonce: hex::encode(nonce_bytes),
            ciphertext: hex::encode(ciphertext),
        })
    }

    fn verify_master_key(
        vault: &WalletVault,
        password: &str,
        key: &[u8; 32],
    ) -> Result<(), String> {
        if let Some(verifier) = &vault.master_verifier {
            let nonce_bytes = hex::decode(&verifier.nonce)
                .map_err(|_| "主密码校验信息损坏".to_string())?;
            if nonce_bytes.len() != 12 {
                return Err("主密码校验信息损坏".to_string());
            }
            let ciphertext = hex::decode(&verifier.ciphertext)
                .map_err(|_| "主密码校验信息损坏".to_string())?;
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
            let plain = cipher
                .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
                .map_err(|_| "主密码错误".to_string())?;
            if plain == Self::MASTER_VERIFIER_PLAINTEXT {
                Ok(())
            } else {
                Err("主密码错误".to_string())
            }
        } else if let Some(first) = vault.wallets.first() {
            let salt = hex::decode(&first.salt).map_err(|_| "钱包 salt 损坏".to_string())?;
            let nonce_bytes = hex::decode(&first.nonce).map_err(|_| "钱包 nonce 损坏".to_string())?;
            let ciphertext = hex::decode(&first.encrypted_private_key)
                .map_err(|_| "钱包密文损坏".to_string())?;
            let derived = {
                let params = Params::new(64 * 1024, 3, 1, Some(32))
                    .map_err(|e| format!("Argon2 参数错误: {}", e))?;
                let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
                let mut wallet_key = [0u8; 32];
                argon
                    .hash_password_into(password.as_bytes(), &salt, &mut wallet_key)
                    .map_err(|e| format!("密钥派生失败: {}", e))?;
                wallet_key
            };
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&derived));
            cipher
                .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
                .map(|_| ())
                .map_err(|_| "主密码错误".to_string())
        } else {
            Err("钱包库缺少密码校验信息，请重置钱包库后重新初始化。".to_string())
        }
    }

    fn try_migrate_master_verifier(&self, password: &str) -> Result<WalletVault, String> {
        let mut vault = self.read_vault();
        let salt_hex = vault
            .master_salt
            .clone()
            .ok_or_else(|| "尚未设置主密码".to_string())?;
        let salt = hex::decode(&salt_hex).map_err(|_| "主密码校验失败".to_string())?;
        let derived = self.derive_key(password, &salt)?;
        vault.master_verifier = Some(Self::build_master_verifier(&derived.key)?);
        Ok(vault)
    }
}

fn epoch_sec() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// 统一的密码格式校验（前后端必须完全一致）：长度 ≥ 8 个 Unicode 字符。
/// 不限制字符类型，允许字母、数字、符号和空白字符。
///
/// 返回 Ok(()) 时格式合规；Err(静态字符串) 时为用户可读的错误原因。
/// 注意：这里的错误原因只返回给 init / change；verify 为了防枚举仍会统一脱敏成"主密码错误"。
fn validate_password_format(password: &str) -> Result<(), &'static str> {
    if password.chars().count() < 8 {
        return Err("主密码至少 8 位字符。");
    }
    Ok(())
}

#[allow(dead_code)]
pub type TempMap = HashMap<String, String>;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (WalletStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "eth-vanity-wallet-test-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        (WalletStore::new(&dir), dir)
    }

    fn sample_wallet() -> Wallet {
        Wallet {
            address: "0x1111111111111111111111111111111111111111".to_string(),
            private_key: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_string(),
        }
    }

    #[test]
    fn master_password_verifier_rejects_wrong_password() {
        let (store, dir) = temp_store();
        store.init_master_password("12345678").unwrap();

        assert!(store.verify_password("12345678").is_ok());
        assert!(store.verify_password("87654321").is_err());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn save_and_decrypt_require_master_password() {
        let (store, dir) = temp_store();
        let wallet = sample_wallet();
        store.init_master_password("12345678").unwrap();

        assert!(store
            .save_wallet(&wallet, "87654321", None, None)
            .is_err());

        let id = store
            .save_wallet(&wallet, "12345678", Some("test".to_string()), None)
            .unwrap();

        assert!(store.decrypt_wallet(id, "87654321").is_err());
        assert_eq!(
            store.decrypt_wallet(id, "12345678").unwrap().private_key,
            wallet.private_key
        );

        let _ = std::fs::remove_dir_all(dir);
    }
}
