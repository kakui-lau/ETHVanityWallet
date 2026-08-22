pub mod store;
pub mod export;

use serde::{Deserialize, Serialize};

use crate::vanity::Wallet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationStats {
    pub attempts: u64,
    pub elapsed_ms: u64,
    pub found: u64,
}

pub fn private_key_to_address(private_key_bytes: &[u8; 32]) -> Option<Wallet> {
    use secp256k1::{Secp256k1, SecretKey};
    use tiny_keccak::{Hasher, Keccak};

    let secp = Secp256k1::new();
    let sk = SecretKey::from_slice(private_key_bytes).ok()?;
    let pk = sk.public_key(&secp);
    let uncompressed = pk.serialize_uncompressed();

    let mut keccak = Keccak::v256();
    let mut hash = [0u8; 32];
    keccak.update(&uncompressed[1..65]);
    keccak.finalize(&mut hash);

    let mut address_bytes = [0u8; 20];
    address_bytes.copy_from_slice(&hash[12..32]);

    let address = format!("0x{}", hex::encode(address_bytes));
    let private_key = hex::encode(private_key_bytes);

    Some(Wallet {
        address,
        private_key,
    })
}

pub fn generate_random_private_key() -> [u8; 32] {
    use rand::RngCore;
    let mut key = [0u8; 32];
    loop {
        rand::thread_rng().fill_bytes(&mut key);
        if is_valid_private_key(&key) {
            return key;
        }
    }
}

fn is_valid_private_key(key: &[u8; 32]) -> bool {
    const N_MINUS_1: [u8; 32] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE,
        0xBA, 0xAE, 0xDC, 0xE6, 0xAF, 0x48, 0xA0, 0x3B,
        0xBF, 0xD2, 0x5E, 0x8C, 0xD0, 0x36, 0x41, 0x40,
    ];
    let mut is_zero = true;
    for &b in key.iter() {
        if b != 0 {
            is_zero = false;
            break;
        }
    }
    if is_zero {
        return false;
    }
    for i in 0..32 {
        if key[i] < N_MINUS_1[i] {
            return true;
        }
        if key[i] > N_MINUS_1[i] {
            return false;
        }
    }
    true
}

pub fn generate_single() -> Wallet {
    loop {
        let sk = generate_random_private_key();
        if let Some(w) = private_key_to_address(&sk) {
            return w;
        }
    }
}

pub fn cpu_thread_count() -> usize {
    rayon::current_num_threads()
}
