use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::vanity::Wallet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeystoreCrypto {
    pub cipher: String,
    pub ciphertext: String,
    #[serde(rename = "cipherparams")]
    pub cipher_params: KeystoreCipherParams,
    pub kdf: String,
    #[serde(rename = "kdfparams")]
    pub kdf_params: KeystoreKdfParams,
    pub mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeystoreCipherParams {
    pub iv: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeystoreKdfParams {
    pub dklen: u32,
    pub salt: String,
    pub n: u32,
    pub r: u32,
    pub p: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeystoreV3 {
    pub version: u32,
    pub id: String,
    pub address: String,
    pub crypto: KeystoreCrypto,
}

fn aes_128_cbc_encrypt(key: &[u8; 16], iv: &[u8; 16], plain: &[u8]) -> Vec<u8> {
    use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
    type Enc = cbc::Encryptor<aes::Aes128>;
    let cipher = Enc::new(key.into(), iv.into());
    let block_size = 16;
    let padded_len = ((plain.len() + block_size - 1) / block_size + 1) * block_size;
    let mut buf = vec![0u8; padded_len];
    buf[..plain.len()].copy_from_slice(plain);
    let n = cipher
        .encrypt_padded_mut::<Pkcs7>(&mut buf, plain.len())
        .expect("encrypt");
    n.to_vec()
}

fn aes_128_cbc_decrypt(key: &[u8; 16], iv: &[u8; 16], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
    type Dec = cbc::Decryptor<aes::Aes128>;
    let cipher = Dec::new(key.into(), iv.into());
    let mut buf = ciphertext.to_vec();
    let plain = cipher
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| "AES 解密失败".to_string())?;
    Ok(plain.to_vec())
}

pub fn keystore_v3_from_wallet(wallet: &Wallet, password: &str) -> Result<KeystoreV3, String> {
    use scrypt::scrypt;
    use uuid::Uuid;

    let mut salt = [0u8; 32];
    let mut iv_bytes = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut iv_bytes);

    let params = scrypt::Params::new(18, 8, 1, 32).map_err(|e| e.to_string())?;
    let mut derived_key = [0u8; 32];
    scrypt(password.as_bytes(), &salt, &params, &mut derived_key)
        .map_err(|e| format!("scrypt 失败: {}", e))?;

    let pk_bytes = hex::decode(&wallet.private_key).map_err(|_| "私钥格式错误")?;
    let enc_key: [u8; 16] = derived_key[0..16].try_into().unwrap();
    let ciphertext = aes_128_cbc_encrypt(&enc_key, &iv_bytes, &pk_bytes);

    let mac_input: Vec<u8> = derived_key[16..32]
        .iter()
        .chain(ciphertext.iter())
        .cloned()
        .collect();
    let mut hasher = Sha256::new();
    hasher.update(&mac_input);
    let mac = hex::encode(hasher.finalize());

    let address = wallet.address.trim_start_matches("0x").to_ascii_lowercase();

    Ok(KeystoreV3 {
        version: 3,
        id: Uuid::new_v4().to_string(),
        address,
        crypto: KeystoreCrypto {
            cipher: "aes-128-cbc".into(),
            ciphertext: hex::encode(&ciphertext),
            cipher_params: KeystoreCipherParams {
                iv: hex::encode(iv_bytes),
            },
            kdf: "scrypt".into(),
            kdf_params: KeystoreKdfParams {
                dklen: 32,
                salt: hex::encode(salt),
                n: 262144,
                r: 8,
                p: 1,
            },
            mac,
        },
    })
}

pub fn keystore_to_private_key(ks: &KeystoreV3, password: &str) -> Result<String, String> {
    use scrypt::scrypt;

    let salt = hex::decode(&ks.crypto.kdf_params.salt).map_err(|_| "salt 损坏")?;
    let iv = hex::decode(&ks.crypto.cipher_params.iv).map_err(|_| "iv 损坏")?;
    let ciphertext = hex::decode(&ks.crypto.ciphertext).map_err(|_| "密文损坏")?;
    if iv.len() != 16 {
        return Err("iv 长度错误".into());
    }
    let iv_arr: [u8; 16] = iv.try_into().unwrap();

    let params = scrypt::Params::new(18, 8, 1, 32).map_err(|e| e.to_string())?;
    let mut derived_key = [0u8; 32];
    scrypt(password.as_bytes(), &salt, &params, &mut derived_key)
        .map_err(|e| format!("scrypt 失败: {}", e))?;

    let mac_input: Vec<u8> = derived_key[16..32]
        .iter()
        .chain(ciphertext.iter())
        .cloned()
        .collect();
    let mut hasher = Sha256::new();
    hasher.update(&mac_input);
    let mac = hex::encode(hasher.finalize());
    if mac != ks.crypto.mac {
        return Err("MAC 校验失败，密码错误或 keystore 损坏".into());
    }

    let dec_key: [u8; 16] = derived_key[0..16].try_into().unwrap();
    let pk_bytes = aes_128_cbc_decrypt(&dec_key, &iv_arr, &ciphertext)?;
    Ok(hex::encode(pk_bytes))
}

pub fn generate_qr_svg(data: &str, size_px: usize) -> Result<String, String> {
    use qrcode::{render::svg, QrCode};
    let qr = QrCode::new(data.as_bytes()).map_err(|e| format!("QR 编码错误: {}", e))?;
    let size = ((size_px.max(64) / 8 + 4) * 8) as u32;
    let svg_string = qr
        .render()
        .min_dimensions(size, size)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#FFFFFF"))
        .build();
    Ok(svg_string)
}

pub fn export_text_content(
    wallet: &Wallet,
    format: &str,
    keystore_password: Option<&str>,
) -> Result<String, String> {
    match format {
        "private_key" => Ok(wallet.private_key.clone()),
        "address" => Ok(wallet.address.clone()),
        "csv" => Ok(format!(
            "address,private_key\n{},{}",
            wallet.address, wallet.private_key
        )),
        "keystore_v3" => {
            let pw = keystore_password.ok_or("keystore 需要密码")?;
            let ks = keystore_v3_from_wallet(wallet, pw)?;
            serde_json::to_string_pretty(&ks).map_err(|e| e.to_string())
        }
        _ => Err(format!("未知导出格式: {}", format)),
    }
}
