//! Obfuscation module providing map-based character substitution.

mod map;

pub use map::{
    analyze_map, generate_map, get_config_from_temperature, get_expansion_ratio,
    get_temperature_profile, GenerateMapOptions, MapAnalysis, TemperatureConfig,
};

use crate::Result;
use alloc::{
    collections::BTreeMap,
    string::{String, ToString},
    vec::Vec,
};
use serde::{Deserialize, Serialize};

/// Obfuscation map: maps characters to arrays of possible substitutions
pub type ObfuscationMap = BTreeMap<char, Vec<String>>;

/// Result of an obfuscation operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObfuscationResult {
    /// Obfuscated text
    pub obfuscated: String,
    /// Statistics about the obfuscation
    pub stats: ObfuscationStats,
}

/// Statistics about an obfuscation operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObfuscationStats {
    /// Original text length
    pub original_length: usize,
    /// Obfuscated text length
    pub obfuscated_length: usize,
    /// Expansion ratio
    pub expansion_ratio: f64,
    /// Number of unique characters obfuscated
    pub unique_chars_obfuscated: usize,
    /// Number of mappings used
    pub mappings_used: usize,
}

/// Selection strategy for choosing among multiple mappings
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SelectionStrategy {
    /// Random selection based on seed
    #[default]
    Random,
    /// Round-robin through mappings
    RoundRobin,
    /// Always choose shortest mapping
    Shortest,
    /// Always choose longest mapping
    Longest,
}

/// Options for obfuscation
#[derive(Debug, Clone)]
pub struct ObfuscationOptions {
    /// Seed for deterministic random selection
    pub seed: String,
    /// Selection strategy
    pub strategy: SelectionStrategy,
}

impl Default for ObfuscationOptions {
    fn default() -> Self {
        Self {
            seed: "default-seed".to_string(),
            strategy: SelectionStrategy::Random,
        }
    }
}

/// Delimiter used between obfuscated tokens
/// Using a character that's NOT in the default charset to avoid conflicts
/// U+001F (Unit Separator) is a control character not used in normal text
pub const DELIMITER: char = '\x1F';

/// Simple seeded random number generator
struct SeededRandom {
    state: u64,
}

impl SeededRandom {
    fn new(seed: &str) -> Self {
        let mut hash: u64 = 0;
        for (i, byte) in seed.bytes().enumerate() {
            hash = hash.wrapping_add((byte as u64).wrapping_mul(31u64.wrapping_pow(i as u32)));
        }
        Self { state: hash.max(1) }
    }

    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_mul(9301).wrapping_add(49297) % 233280;
        self.state
    }

    fn next_usize(&mut self, max: usize) -> usize {
        (self.next() as usize) % max
    }
}

/// Obfuscate text using the provided map
pub fn obfuscate(
    text: &str,
    map: &ObfuscationMap,
    options: Option<ObfuscationOptions>,
) -> ObfuscationResult {
    let opts = options.unwrap_or_default();
    let _rng = SeededRandom::new(&opts.seed);

    let mut tokens: Vec<String> = Vec::with_capacity(text.len());
    let mut unique_chars = std::collections::HashSet::new();
    let mut mappings_used = 0;

    for (i, char) in text.chars().enumerate() {
        if let Some(mappings) = map.get(&char) {
            if !mappings.is_empty() {
                unique_chars.insert(char);

                let selected = match opts.strategy {
                    SelectionStrategy::Random => {
                        // Use char code + position for additional entropy
                        let entropy = (char as u64).wrapping_add(i as u64);
                        let mut local_rng = SeededRandom::new(&format!("{}{}", opts.seed, entropy));
                        &mappings[local_rng.next_usize(mappings.len())]
                    }
                    SelectionStrategy::RoundRobin => &mappings[i % mappings.len()],
                    SelectionStrategy::Shortest => mappings.iter().min_by_key(|s| s.len()).unwrap(),
                    SelectionStrategy::Longest => mappings.iter().max_by_key(|s| s.len()).unwrap(),
                };

                tokens.push(selected.clone());
                mappings_used += 1;
                continue;
            }
        }

        // Character not in map, keep as-is
        // But if it's the delimiter, we need to handle it specially
        // Since delimiter is not in charset, this shouldn't happen, but be safe
        if char == DELIMITER {
            // This shouldn't happen if charset doesn't include delimiter
            // But if it does, we need to escape it or use a placeholder
            tokens.push("_DELIM_".to_string());
        } else {
            tokens.push(char.to_string());
        }
    }

    let obfuscated = tokens.join(&DELIMITER.to_string());
    let original_length = text.len();
    let obfuscated_length = obfuscated.len();

    ObfuscationResult {
        obfuscated,
        stats: ObfuscationStats {
            original_length,
            obfuscated_length,
            expansion_ratio: obfuscated_length as f64 / original_length as f64,
            unique_chars_obfuscated: unique_chars.len(),
            mappings_used,
        },
    }
}

/// Deobfuscate text using the provided map
pub fn deobfuscate(obfuscated: &str, map: &ObfuscationMap) -> String {
    // Build reverse map
    let mut reverse_map: BTreeMap<&str, char> = BTreeMap::new();
    for (char, mappings) in map.iter() {
        for mapping in mappings {
            reverse_map.insert(mapping.as_str(), *char);
        }
    }

    // Split by delimiter and reverse each token
    obfuscated
        .split(DELIMITER)
        .map(|token| {
            // Handle delimiter placeholder
            if token == "_DELIM_" {
                return DELIMITER.to_string();
            }
            if let Some(&original) = reverse_map.get(token) {
                original.to_string()
            } else {
                // Token not found in map, return as-is
                token.to_string()
            }
        })
        .collect()
}

/// Test obfuscation roundtrip
pub fn test_roundtrip(
    text: &str,
    map: &ObfuscationMap,
    options: Option<ObfuscationOptions>,
) -> Result<bool> {
    let result = obfuscate(text, map, options);
    let deobfuscated = deobfuscate(&result.obfuscated, map);
    Ok(text == deobfuscated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_map() -> ObfuscationMap {
        let mut map = ObfuscationMap::new();
        map.insert('a', vec!["alpha".to_string(), "apple".to_string()]);
        map.insert('b', vec!["bravo".to_string(), "banana".to_string()]);
        map.insert('c', vec!["charlie".to_string()]);
        map.insert(' ', vec!["_space_".to_string()]);
        map
    }

    #[test]
    fn test_obfuscate_deobfuscate() {
        let map = create_test_map();
        let text = "abc";

        let result = obfuscate(text, &map, None);
        let deobfuscated = deobfuscate(&result.obfuscated, &map);

        assert_eq!(text, deobfuscated);
    }

    #[test]
    fn test_deterministic_with_seed() {
        let map = create_test_map();
        let text = "abc";
        let options = ObfuscationOptions {
            seed: "test-seed".to_string(),
            strategy: SelectionStrategy::Random,
        };

        let result1 = obfuscate(text, &map, Some(options.clone()));
        let result2 = obfuscate(text, &map, Some(options));

        // Same seed should produce same output
        assert_eq!(result1.obfuscated, result2.obfuscated);
    }

    #[test]
    fn test_different_seeds() {
        let map = create_test_map();
        let text = "aaa"; // Multiple 'a' chars with multiple mappings

        let result1 = obfuscate(
            text,
            &map,
            Some(ObfuscationOptions {
                seed: "seed1".to_string(),
                strategy: SelectionStrategy::Random,
            }),
        );

        let result2 = obfuscate(
            text,
            &map,
            Some(ObfuscationOptions {
                seed: "seed2".to_string(),
                strategy: SelectionStrategy::Random,
            }),
        );

        // Different seeds may produce different outputs (though not guaranteed)
        // Both should deobfuscate correctly
        assert_eq!(deobfuscate(&result1.obfuscated, &map), text);
        assert_eq!(deobfuscate(&result2.obfuscated, &map), text);
    }

    #[test]
    fn test_selection_strategies() {
        let map = create_test_map();
        let text = "a";

        let shortest = obfuscate(
            text,
            &map,
            Some(ObfuscationOptions {
                seed: "test".to_string(),
                strategy: SelectionStrategy::Shortest,
            }),
        );

        let longest = obfuscate(
            text,
            &map,
            Some(ObfuscationOptions {
                seed: "test".to_string(),
                strategy: SelectionStrategy::Longest,
            }),
        );

        // Shortest should be "alpha" (5 chars), longest "apple" (5 chars) - both same length
        // Just verify they deobfuscate correctly
        assert_eq!(deobfuscate(&shortest.obfuscated, &map), "a");
        assert_eq!(deobfuscate(&longest.obfuscated, &map), "a");
    }

    #[test]
    fn test_unmapped_characters() {
        let map = create_test_map();
        let text = "a1b2c"; // 1 and 2 not in map

        let result = obfuscate(text, &map, None);
        let deobfuscated = deobfuscate(&result.obfuscated, &map);

        assert_eq!(text, deobfuscated);
    }

    #[test]
    fn test_roundtrip_fn() {
        let map = create_test_map();
        let text = "abc test";

        assert!(super::test_roundtrip(text, &map, None).unwrap());
    }
}
