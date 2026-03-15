//! Map generation for character obfuscation.
//!
//! Generates deterministic obfuscation maps based on temperature and seed.

use alloc::{
    collections::BTreeMap,
    string::{String, ToString},
    vec::Vec,
};
use serde::{Deserialize, Serialize};

use super::ObfuscationMap;

/// Temperature configuration for map generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemperatureConfig {
    /// Temperature value (0.0 to 1.0)
    pub temperature: f64,
    /// Minimum number of mappings per character
    pub min_mappings: usize,
    /// Maximum number of mappings per character
    pub max_mappings: usize,
    /// Minimum length of individual mappings
    pub min_length: usize,
    /// Maximum length of individual mappings
    pub max_length: usize,
    /// Target expansion ratio
    pub expansion_ratio: f64,
    /// Relative computational cost (0-100)
    pub compute_score: u32,
}

impl Default for TemperatureConfig {
    fn default() -> Self {
        Self {
            temperature: 0.5,
            min_mappings: 2,
            max_mappings: 5,
            min_length: 2,
            max_length: 8,
            expansion_ratio: 2.1,
            compute_score: 40,
        }
    }
}

/// Pre-defined temperature profiles
pub fn get_temperature_profile(name: &str) -> Option<TemperatureConfig> {
    match name {
        "minimal" => Some(TemperatureConfig {
            temperature: 0.0,
            min_mappings: 1,
            max_mappings: 2,
            min_length: 2, // Minimum 2 chars to avoid charset collisions
            max_length: 3,
            expansion_ratio: 1.5,
            compute_score: 5,
        }),
        "low" => Some(TemperatureConfig {
            temperature: 0.2,
            min_mappings: 1,
            max_mappings: 3,
            min_length: 2, // Minimum 2 chars to avoid charset collisions
            max_length: 4,
            expansion_ratio: 1.5,
            compute_score: 15,
        }),
        "medium" => Some(TemperatureConfig {
            temperature: 0.5,
            min_mappings: 2,
            max_mappings: 5,
            min_length: 2,
            max_length: 8,
            expansion_ratio: 2.1,
            compute_score: 40,
        }),
        "high" => Some(TemperatureConfig {
            temperature: 0.8,
            min_mappings: 3,
            max_mappings: 8,
            min_length: 3,
            max_length: 12,
            expansion_ratio: 3.7,
            compute_score: 75,
        }),
        "extreme" => Some(TemperatureConfig {
            temperature: 1.0,
            min_mappings: 5,
            max_mappings: 15,
            min_length: 4,
            max_length: 20,
            expansion_ratio: 6.2,
            compute_score: 100,
        }),
        _ => None,
    }
}

/// Get temperature config from temperature value
pub fn get_config_from_temperature(temperature: f64) -> TemperatureConfig {
    let clamped = temperature.clamp(0.0, 1.0);

    // Interpolate between profiles
    if clamped <= 0.1 {
        get_temperature_profile("minimal").unwrap()
    } else if clamped <= 0.3 {
        get_temperature_profile("low").unwrap()
    } else if clamped <= 0.6 {
        get_temperature_profile("medium").unwrap()
    } else if clamped <= 0.85 {
        get_temperature_profile("high").unwrap()
    } else {
        get_temperature_profile("extreme").unwrap()
    }
}

/// Options for map generation
#[derive(Debug, Clone)]
pub struct GenerateMapOptions {
    /// Temperature (0.0 to 1.0)
    pub temperature: f64,
    /// Seed for deterministic generation
    pub seed: Option<String>,
    /// Character set to create mappings for
    pub charset: Option<String>,
}

impl Default for GenerateMapOptions {
    fn default() -> Self {
        Self {
            temperature: 0.5,
            seed: None,
            charset: None,
        }
    }
}

/// Seeded random number generator for deterministic map generation
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
        if max == 0 {
            return 0;
        }
        (self.next() as usize) % max
    }

    fn next_range(&mut self, min: usize, max: usize) -> usize {
        if min >= max {
            return min;
        }
        min + self.next_usize(max - min + 1)
    }
}

/// Word pools for different complexity levels
/// IMPORTANT: All mappings must be at least 2 characters to avoid collisions
/// with charset characters during deobfuscation. A single character mapping
/// like "a" would collide when "a" appears as an unmapped character in text.
const SIMPLE_WORDS: &[&str] = &[
    "aa", "ab", "ac", "ad", "ae", "af", "ag", "ah", "ai", "aj", "ak", "al", "am", "an", "ao", "ap",
    "aq", "ar", "as", "at", "au", "av", "aw", "ax", "ay", "az", "ba", "bb", "bc", "bd", "bf", "bg",
    "bh", "bi", "bj", "bk", "bl", "bm", "bn", "bo", "bp", "bq", "br", "bs", "bt", "bu", "bv", "bw",
    "bx", "by", "bz",
];

const SHORT_WORDS: &[&str] = &[
    "ox", "go", "hi", "me", "we", "up", "in", "on", "at", "to", "be", "do", "he", "it", "my", "no",
    "of", "so", "us", "an",
];

const MEDIUM_WORDS: &[&str] = &[
    "cat", "dog", "sun", "moon", "star", "tree", "bird", "fish", "book", "door", "hand", "eye",
    "car", "red", "blue", "gold", "fire", "water", "earth", "wind",
];

const WORDS: &[&str] = &[
    "apple", "beach", "cloud", "dream", "eagle", "flame", "green", "heart", "ivory", "jewel",
    "knife", "lemon", "magic", "north", "ocean", "pearl", "quiet", "river", "storm", "tower",
];

const PHRASES: &[&str] = &[
    "bright_star",
    "deep_ocean",
    "wild_forest",
    "golden_sand",
    "silver_moon",
    "crystal_clear",
    "gentle_breeze",
    "warm_sunshine",
    "cool_shadow",
    "fresh_water",
    "ancient_tree",
    "peaceful_valley",
    "endless_sky",
    "hidden_treasure",
    "mystic_fog",
];

const COMPLEX: &[&str] = &[
    "thunderstorm_approaching",
    "crystalline_formation",
    "electromagnetic_pulse",
    "quantum_entanglement",
    "bioluminescent_glow",
    "aerodynamic_structure",
    "photosynthetic_process",
    "metamorphic_transformation",
    "exponential_growth",
    "algorithmic_complexity",
];

/// Default character set for obfuscation
/// Note: Delimiter (U+001F) is NOT included to avoid conflicts
const DEFAULT_CHARSET: &str = 
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \t\n.,!?;:()[]{}\"'-=+*/%&@#$^~`|\\<>";

/// Generate random strings for the word pool
/// Ensures generated strings don't contain control characters or the delimiter
fn generate_random_strings(
    count: usize,
    min_length: usize,
    max_length: usize,
    rng: &mut SeededRandom,
) -> Vec<String> {
    // Safe characters only: alphanumeric, underscore, hyphen
    // Excludes control characters and the delimiter (U+001F)
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
    let mut result = Vec::with_capacity(count);

    for _ in 0..count {
        let length = rng.next_range(min_length, max_length);
        let mut s = String::with_capacity(length);
        for _ in 0..length {
            let idx = rng.next_usize(CHARS.len());
            s.push(CHARS[idx] as char);
        }
        result.push(s);
    }

    result
}

/// Generate word pool based on temperature config
fn generate_word_pool(config: &TemperatureConfig, rng: &mut SeededRandom) -> Vec<String> {
    let mut pools: Vec<String> = Vec::new();

    // Select word pools based on length requirements
    // Include pools that have words within our min-max length range
    // SIMPLE_WORDS: 2-char words
    // SHORT_WORDS: 2-char words
    // MEDIUM_WORDS: 3-5 char words
    // WORDS: 5+ char words
    // PHRASES: longer compound words
    // COMPLEX: very long words

    // Always include SIMPLE and SHORT for min_length <= 2
    if config.max_length >= 2 {
        pools.extend(SIMPLE_WORDS.iter().map(|s| s.to_string()));
        pools.extend(SHORT_WORDS.iter().map(|s| s.to_string()));
    }
    // Include MEDIUM for max_length >= 3
    if config.max_length >= 3 {
        pools.extend(MEDIUM_WORDS.iter().map(|s| s.to_string()));
    }
    // Include WORDS for max_length >= 5
    if config.max_length >= 5 {
        pools.extend(WORDS.iter().map(|s| s.to_string()));
    }
    // Include PHRASES for higher temperatures
    if config.temperature >= 0.5 && config.max_length >= 10 {
        pools.extend(PHRASES.iter().map(|s| s.to_string()));
    }
    // Include COMPLEX for very high temperatures
    if config.temperature >= 0.8 && config.max_length >= 15 {
        pools.extend(COMPLEX.iter().map(|s| s.to_string()));
    }

    // Add random strings based on temperature
    let random_count = (config.temperature * 200.0) as usize;
    if random_count > 0 {
        pools.extend(generate_random_strings(
            random_count,
            config.min_length,
            config.max_length,
            rng,
        ));
    }

    // Filter by length requirements and ensure no unsafe characters
    // Remove any words containing control characters or the delimiter
    // CRITICAL: All mappings must be at least 2 characters to avoid collisions
    // with charset characters during deobfuscation
    // Sort first to ensure deterministic filtering order
    pools.sort();
    let min_mapping_length = config.min_length.max(2); // Force minimum of 2
    let mut filtered: Vec<String> = pools
        .into_iter()
        .filter(|word| {
            word.len() >= min_mapping_length
                && word.len() <= config.max_length
                && !word.chars().any(|c| {
                    // Exclude control characters (0x00-0x1F) except tab and newline
                    // But actually, we should exclude ALL control characters for JSON safety
                    // Also exclude the delimiter
                    c == '\x1F' || (c < ' ' && c != '\t' && c != '\n')
                })
        })
        .collect();

    // Word pool size is variable based on temperature
    // Lower temperature = smaller pool (simpler mappings)
    // Higher temperature = larger pool (more complex mappings)
    // Minimum pool size to ensure we have enough unique mappings
    let min_pool_size = 50;
    let target_pool_size = min_pool_size + ((config.temperature * 150.0) as usize);

    // Generate additional random strings if needed to reach target size
    while filtered.len() < target_pool_size {
        let needed = target_pool_size - filtered.len();
        let additional = generate_random_strings(
            needed * 2,         // Generate extra to account for potential filtering
            min_mapping_length, // Use the safe minimum
            config.max_length,
            rng,
        );
        // Filter the additional strings and add them
        for word in additional {
            if word.len() >= min_mapping_length
                && word.len() <= config.max_length
                && !word
                    .chars()
                    .any(|c| c == '\x1F' || (c < ' ' && c != '\t' && c != '\n'))
                && !filtered.contains(&word)
            {
                filtered.push(word);
                if filtered.len() >= target_pool_size {
                    break;
                }
            }
        }
    }

    // Don't truncate - keep variable size based on temperature
    // But ensure we have at least the minimum
    if filtered.len() < min_pool_size {
        // This shouldn't happen, but ensure minimum
        let needed = min_pool_size - filtered.len();
        let additional = generate_random_strings(
            needed * 2,
            min_mapping_length, // Use the safe minimum
            config.max_length,
            rng,
        );
        for word in additional {
            if word.len() >= min_mapping_length
                && word.len() <= config.max_length
                && !word
                    .chars()
                    .any(|c| c == '\x1F' || (c < ' ' && c != '\t' && c != '\n'))
                && !filtered.contains(&word)
            {
                filtered.push(word);
                if filtered.len() >= min_pool_size {
                    break;
                }
            }
        }
    }

    // Sort before shuffling to ensure deterministic starting point
    filtered.sort();

    // Shuffle the pool deterministically
    for i in (1..filtered.len()).rev() {
        let j = rng.next_usize(i + 1);
        filtered.swap(i, j);
    }

    filtered
}

/// Generate an obfuscation map with temperature-based complexity
///
/// # Arguments
///
/// * `options` - Generation options including temperature and seed
///
/// # Returns
///
/// An ObfuscationMap mapping each character to possible substitutions
pub fn generate_map(options: Option<GenerateMapOptions>) -> ObfuscationMap {
    let opts = options.unwrap_or_default();
    let temperature = opts.temperature.clamp(0.0, 1.0);

    // Generate seed if not provided - use deterministic hash instead of thread_rng
    // to avoid N-API deadlock issues
    let seed = opts.seed.unwrap_or_else(|| {
        // Create a deterministic seed from temperature
        // In practice, the TypeScript wrapper should always provide a seed
        // This is just a fallback that won't deadlock
        let temp_bits = temperature.to_bits();
        let mut hash: u64 = 0;
        for i in 0..8 {
            hash = hash
                .wrapping_mul(31)
                .wrapping_add(((temp_bits >> (i * 8)) & 0xFF) as u64);
        }
        format!("{:016x}", hash)
    });

    let charset = opts.charset.unwrap_or_else(|| DEFAULT_CHARSET.to_string());

    let config = get_config_from_temperature(temperature);
    // Create a fresh RNG for word pool generation to ensure determinism
    let mut pool_rng = SeededRandom::new(&format!("{}-pool", seed));
    let word_pool = generate_word_pool(&config, &mut pool_rng);

    let mut map: ObfuscationMap = BTreeMap::new();
    let mut used_mappings: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Collect charset characters into a Vec and sort for deterministic iteration order
    let mut charset_chars: Vec<char> = charset.chars().collect();
    charset_chars.sort();

    // Pre-calculate how many mappings each character needs (deterministic)
    // This ensures we know the total needed before we start assigning
    let char_mapping_counts: Vec<(char, usize)> = charset_chars
        .iter()
        .map(|&ch| {
            // Use a char-specific RNG to determine mapping count deterministically
            let mut count_rng = SeededRandom::new(&format!("{}-count-{}", seed, ch as u32));
            let count = count_rng.next_range(config.min_mappings, config.max_mappings);
            (ch, count)
        })
        .collect();

    // Calculate total mappings needed
    let total_mappings_needed: usize = char_mapping_counts.iter().map(|(_, count)| count).sum();

    // Ensure word pool is large enough (variable based on temperature)
    // Generate more words if needed, but keep it deterministic
    // CRITICAL: All mappings must be at least 2 characters
    let min_extend_length = config.min_length.max(2);
    let mut extended_word_pool = word_pool.clone();
    if extended_word_pool.len() < total_mappings_needed {
        let needed = total_mappings_needed - extended_word_pool.len();
        let mut extend_rng = SeededRandom::new(&format!("{}-extend", seed));
        let additional = generate_random_strings(
            needed * 3, // Generate extra to account for uniqueness checks and filtering
            min_extend_length,
            config.max_length,
            &mut extend_rng,
        );
        // Filter and collect additional words (must be at least 2 chars)
        let mut filtered_additional: Vec<String> = additional
            .into_iter()
            .filter(|word| {
                word.len() >= 2 // Absolute minimum to avoid charset collisions
                    && word.len() >= min_extend_length 
                    && word.len() <= config.max_length
                    && !word.chars().any(|c| c == '\x1F' || (c < ' ' && c != '\t' && c != '\n'))
                    && !extended_word_pool.contains(word)
            })
            .collect();

        // Sort before adding to ensure deterministic order
        filtered_additional.sort();
        extended_word_pool.extend(
            filtered_additional
                .into_iter()
                .take(total_mappings_needed * 2),
        );
    }

    // Sort word pool for deterministic selection order
    extended_word_pool.sort();

    // Now assign mappings deterministically
    let mut word_pool_index = 0;
    for (char, num_mappings) in char_mapping_counts {
        let mut mappings: Vec<String> = Vec::with_capacity(num_mappings);

        // Try to get mappings from the word pool first (deterministic order)
        while mappings.len() < num_mappings && word_pool_index < extended_word_pool.len() {
            let word = &extended_word_pool[word_pool_index];
            word_pool_index += 1;

            // Ensure mapping is unique across ALL characters
            if !used_mappings.contains(word) {
                mappings.push(word.clone());
                used_mappings.insert(word.clone());
            }
        }

        // Fallback: generate random strings if we don't have enough from pool
        // Use a char-specific RNG for fallback to ensure determinism
        // CRITICAL: Minimum length of 2 to avoid charset collisions
        let min_fallback_length = config.min_length.max(2);
        let mut fallback_rng = SeededRandom::new(&format!("{}-fallback-{}", seed, char as u32));
        let mut fallback_attempts = 0;
        while mappings.len() < num_mappings && fallback_attempts < num_mappings * 100 {
            fallback_attempts += 1;
            let random_words = generate_random_strings(
                1,
                min_fallback_length,
                config.max_length,
                &mut fallback_rng,
            );
            if let Some(word) = random_words.into_iter().next() {
                // Double-check: ensure word is at least 2 chars, doesn't contain delimiter or control chars
                if word.len() >= 2
                    && !word.contains('\x1F')
                    && !word.chars().any(|c| c < ' ' && c != '\t' && c != '\n')
                    && !used_mappings.contains(&word)
                {
                    used_mappings.insert(word.clone());
                    mappings.push(word);
                }
            }
        }

        // Sort mappings for determinism (same seed should produce same map)
        mappings.sort();
        map.insert(char, mappings);
    }

    map
}

/// Analyze a map and return statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapAnalysis {
    /// Estimated temperature based on characteristics
    pub temperature: f64,
    /// Total number of mappings across all characters
    pub total_mappings: usize,
    /// Average mappings per character
    pub average_mappings_per_char: f64,
    /// Average length of mappings
    pub average_mapping_length: f64,
    /// Expansion ratio
    pub expansion_ratio: f64,
    /// Compute score
    pub compute_score: u32,
    /// Entropy
    pub entropy: f64,
}

/// Analyze an obfuscation map
pub fn analyze_map(map: &ObfuscationMap) -> MapAnalysis {
    let mut total_mappings = 0;
    let mut total_mapping_length = 0;
    let mut entropy = 0.0;

    for mappings in map.values() {
        total_mappings += mappings.len();
        total_mapping_length += mappings.iter().map(|m| m.len()).sum::<usize>();

        if !mappings.is_empty() {
            let p = 1.0 / mappings.len() as f64;
            entropy += mappings.len() as f64 * (-p * p.log2());
        }
    }

    let char_count = map.len();
    let average_mappings_per_char = if char_count > 0 {
        total_mappings as f64 / char_count as f64
    } else {
        0.0
    };

    let average_mapping_length = if total_mappings > 0 {
        total_mapping_length as f64 / total_mappings as f64
    } else {
        0.0
    };

    let expansion_ratio = average_mapping_length;

    // Estimate temperature based on characteristics
    let estimated_temperature =
        ((average_mappings_per_char - 1.0) / 10.0 + expansion_ratio / 10.0).clamp(0.0, 1.0);

    let compute_score =
        (average_mappings_per_char.log2() * 10.0 + average_mapping_length * 2.0) as u32;

    MapAnalysis {
        temperature: estimated_temperature,
        total_mappings,
        average_mappings_per_char,
        average_mapping_length,
        expansion_ratio,
        compute_score,
        entropy: entropy / char_count as f64,
    }
}

/// Get expansion ratio estimate for a map
pub fn get_expansion_ratio(map: &ObfuscationMap) -> f64 {
    let mut total_original = 0;
    let mut total_mapping = 0.0;

    for (char, mappings) in map.iter() {
        total_original += char.len_utf8();
        if !mappings.is_empty() {
            let avg_len: f64 =
                mappings.iter().map(|m| m.len() as f64).sum::<f64>() / mappings.len() as f64;
            total_mapping += avg_len;
        }
    }

    if total_original > 0 {
        total_mapping / total_original as f64
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_map_default() {
        let map = generate_map(None);

        // Should have mappings for default charset
        assert!(!map.is_empty());

        // Each char should have at least one mapping
        for mappings in map.values() {
            assert!(!mappings.is_empty());
        }
    }

    #[test]
    fn test_generate_map_deterministic() {
        let opts = GenerateMapOptions {
            temperature: 0.5,
            seed: Some("test-seed-123".to_string()),
            charset: Some("abc".to_string()),
        };

        let map1 = generate_map(Some(opts.clone()));
        let map2 = generate_map(Some(opts));

        // Same seed should produce same map
        assert_eq!(map1, map2);
    }

    #[test]
    fn test_generate_map_unique_mappings() {
        let map = generate_map(Some(GenerateMapOptions {
            temperature: 0.5,
            seed: Some("unique-test".to_string()),
            charset: Some("abcdef".to_string()),
        }));

        // Collect all mappings
        let mut all_mappings: Vec<&String> = Vec::new();
        for mappings in map.values() {
            all_mappings.extend(mappings.iter());
        }

        // Check uniqueness
        let mut seen: std::collections::HashSet<&String> = std::collections::HashSet::new();
        for mapping in &all_mappings {
            assert!(
                !seen.contains(mapping),
                "Duplicate mapping found: {}",
                mapping
            );
            seen.insert(mapping);
        }
    }

    #[test]
    fn test_temperature_profiles() {
        assert!(get_temperature_profile("minimal").is_some());
        assert!(get_temperature_profile("low").is_some());
        assert!(get_temperature_profile("medium").is_some());
        assert!(get_temperature_profile("high").is_some());
        assert!(get_temperature_profile("extreme").is_some());
        assert!(get_temperature_profile("invalid").is_none());
    }

    #[test]
    fn test_analyze_map() {
        let map = generate_map(Some(GenerateMapOptions {
            temperature: 0.5,
            seed: Some("analyze-test".to_string()),
            charset: Some("abc".to_string()),
        }));

        let analysis = analyze_map(&map);

        assert!(analysis.total_mappings > 0);
        assert!(analysis.average_mappings_per_char > 0.0);
        assert!(analysis.average_mapping_length > 0.0);
    }

    #[test]
    fn test_expansion_ratio() {
        let map = generate_map(Some(GenerateMapOptions {
            temperature: 0.5,
            seed: Some("ratio-test".to_string()),
            charset: Some("ab".to_string()),
        }));

        let ratio = get_expansion_ratio(&map);

        // Ratio should be positive
        assert!(ratio > 0.0);
    }
}
