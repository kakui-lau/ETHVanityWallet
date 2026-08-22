pub mod engine;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wallet {
    pub address: String,
    pub private_key: String,
}

pub mod matcher {
    use super::*;
    use regex::Regex;
    use std::sync::OnceLock;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "mode", rename_all = "snake_case")]
    pub enum MatchRule {
        Prefix { value: String },
        Suffix { value: String },
        Contains { value: String },
        Combo { rules: Vec<MatchRule> },
        Regex { pattern: String },
        WordList { words: Vec<String> },
    }

    #[derive(Clone)]
    pub struct CompiledRule {
        pub rule: MatchRule,
        pub regex: Option<Regex>,
    }

    impl CompiledRule {
        pub fn compile(rule: &MatchRule) -> Result<Self, String> {
            rule.validate()?;
            let regex = match rule {
                MatchRule::Regex { pattern } => {
                    Some(Regex::new(pattern).map_err(|e| format!("正则错误: {}", e))?)
                }
                _ => None,
            };
            Ok(Self {
                rule: rule.clone(),
                regex,
            })
        }
    }

    fn normalize_hex(s: &str) -> String {
        s.trim_start_matches("0x").to_ascii_lowercase()
    }

    fn all_hex(s: &str) -> bool {
        s.chars().all(|c| c.is_ascii_hexdigit())
    }

    impl MatchRule {
        pub fn validate(&self) -> Result<(), String> {
            match self {
                MatchRule::Prefix { value }
                | MatchRule::Suffix { value }
                | MatchRule::Contains { value } => {
                    let clean = normalize_hex(value);
                    if clean.is_empty() {
                        return Err("匹配值不能为空".into());
                    }
                    if !all_hex(&clean) {
                        return Err(format!("非法字符，仅允许 0-9 a-f A-F（得到: '{}'）", value));
                    }
                    if clean.len() > 40 {
                        return Err("匹配长度过长（地址仅 40 个 hex 字符）".into());
                    }
                    Ok(())
                }
                MatchRule::Combo { rules } => {
                    if rules.is_empty() {
                        return Err("组合规则不能为空".into());
                    }
                    for r in rules {
                        r.validate()?;
                    }
                    Ok(())
                }
                MatchRule::Regex { pattern } => {
                    if pattern.is_empty() {
                        return Err("正则不能为空".into());
                    }
                    let _ = Regex::new(pattern).map_err(|e| format!("正则语法错误: {}", e))?;
                    Ok(())
                }
                MatchRule::WordList { words } => {
                    if words.is_empty() {
                        return Err("词库不能为空".into());
                    }
                    for w in words {
                        let c = normalize_hex(w);
                        if c.is_empty() || !all_hex(&c) {
                            return Err(format!("词库词 '{}' 非合法 hex 子串", w));
                        }
                        if c.len() > 40 {
                            return Err(format!(
                                "词库词 '{}' 长度过长（地址仅 40 个 hex 字符）",
                                w
                            ));
                        }
                    }
                    Ok(())
                }
            }
        }

        pub fn expected_difficulty(&self) -> f64 {
            fn hex_difficulty(hex_len: usize) -> f64 {
                16f64.powi(hex_len as i32)
            }
            match self {
                MatchRule::Prefix { value }
                | MatchRule::Suffix { value }
                | MatchRule::Contains { value } => {
                    hex_difficulty(normalize_hex(value).len())
                }
                MatchRule::Combo { rules } => rules.iter().map(|r| r.expected_difficulty()).product(),
                MatchRule::Regex { .. } => 1_000_000.0,
                MatchRule::WordList { words } => {
                    let shortest = words.iter().map(|w| normalize_hex(w).len()).min().unwrap_or(1);
                    hex_difficulty(shortest) / words.len() as f64
                }
            }
        }

        pub fn performance_note(&self) -> &'static str {
            match self {
                MatchRule::Prefix { .. } | MatchRule::Suffix { .. } => "字节级匹配，性能极佳",
                MatchRule::Contains { .. } => "40字节 hex 子串查找，性能良好",
                MatchRule::Combo { .. } => "多规则 AND，性能与规则数量乘积成反比",
                MatchRule::Regex { .. } => "正则引擎开销较大，速率将下降 30-60%",
                MatchRule::WordList { .. } => "多词并行子串查找，性能良好",
            }
        }
    }

    #[inline(always)]
    fn byte_to_hex_pair(byte: u8) -> (u8, u8) {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        (HEX[(byte >> 4) as usize], HEX[(byte & 0x0f) as usize])
    }

    fn build_hex(address_bytes: &[u8; 20], out: &mut [u8; 40]) {
        for i in 0..20 {
            let (hi, lo) = byte_to_hex_pair(address_bytes[i]);
            out[i * 2] = hi;
            out[i * 2 + 1] = lo;
        }
    }

    fn build_prefixed_hex(address_bytes: &[u8; 20], out: &mut [u8; 42]) {
        out[0] = b'0';
        out[1] = b'x';
        for i in 0..20 {
            let (hi, lo) = byte_to_hex_pair(address_bytes[i]);
            out[i * 2 + 2] = hi;
            out[i * 2 + 3] = lo;
        }
    }

    pub fn check_rule(address_bytes: &[u8; 20], compiled: &CompiledRule) -> bool {
        let mut hex_buf = [0u8; 40];
        match &compiled.rule {
            MatchRule::Prefix { value } => {
                let prefix = normalize_hex(value);
                let pb = prefix.as_bytes();
                for (i, &expected) in pb.iter().enumerate() {
                    let byte_idx = i / 2;
                    let (hi, lo) = byte_to_hex_pair(address_bytes[byte_idx]);
                    let actual = if i % 2 == 0 { hi } else { lo };
                    if actual != expected {
                        return false;
                    }
                }
                true
            }
            MatchRule::Suffix { value } => {
                let suffix = normalize_hex(value);
                let sb = suffix.as_bytes();
                let sl = sb.len();
                for (i, &expected) in sb.iter().enumerate() {
                    let pos = 40 - sl + i;
                    let byte_idx = pos / 2;
                    let (hi, lo) = byte_to_hex_pair(address_bytes[byte_idx]);
                    let actual = if pos % 2 == 0 { hi } else { lo };
                    if actual != expected {
                        return false;
                    }
                }
                true
            }
            MatchRule::Contains { value } => {
                let needle = normalize_hex(value);
                let nb = needle.as_bytes();
                build_hex(address_bytes, &mut hex_buf);
                hex_buf.windows(nb.len()).any(|w| w == nb)
            }
            MatchRule::Combo { rules } => {
                static CELL: OnceLock<Vec<CompiledRule>> = OnceLock::new();
                let _ = CELL;
                rules.iter().all(|r| {
                    let cr = CompiledRule::compile(r).unwrap();
                    check_rule(address_bytes, &cr)
                })
            }
            MatchRule::Regex { .. } => {
                if let Some(re) = &compiled.regex {
                    let mut prefixed = [0u8; 42];
                    build_prefixed_hex(address_bytes, &mut prefixed);
                    let s = unsafe { std::str::from_utf8_unchecked(&prefixed) };
                    re.is_match(s)
                } else {
                    false
                }
            }
            MatchRule::WordList { words } => {
                build_hex(address_bytes, &mut hex_buf);
                words.iter().any(|w| {
                    let n = normalize_hex(w);
                    hex_buf.windows(n.len()).any(|w| w == n.as_bytes())
                })
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn validates_full_address_length_for_hex_rules() {
            let forty = "a".repeat(40);
            assert!(MatchRule::Prefix { value: forty }.validate().is_ok());

            let forty_one = "a".repeat(41);
            assert!(MatchRule::Contains { value: forty_one }.validate().is_err());
        }

        #[test]
        fn regex_matches_prefixed_full_address() {
            let bytes = [0xab; 20];
            let rule = MatchRule::Regex {
                pattern: "^0xabab".to_string(),
            };
            let compiled = CompiledRule::compile(&rule).unwrap();

            assert!(check_rule(&bytes, &compiled));
        }
    }
}
