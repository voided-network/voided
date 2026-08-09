//! Deterministic recovery-key derivation from a standard 52-card deck.
//!
//! A recovery deck is secret key material. This module is deliberately
//! stateless: it never persists the deck, its permutation rank, or a derived
//! recovery key. Callers may persist only the authenticated root-key wrapper.

use crate::encryption::{self, Algorithm, EncryptOptions, EncryptionResult, Key};
use crate::{Error, Result};
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use rand::seq::SliceRandom;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Number of cards in the recovery protocol's standard deck.
pub const RECOVERY_DECK_CARD_COUNT: usize = 52;

/// Size of the fixed-width, big-endian permutation rank.
///
/// `52!` needs 226 bits, so every rank from `0` through `52! - 1` fits in 29
/// bytes. Leading zeroes are required and are part of the canonical encoding.
pub const RECOVERY_DECK_ENCODING_SIZE: usize = 29;

/// Fixed HKDF-SHA256 domain for the initial Recovery Deck protocol.
///
/// This value, the card ordering, and the rank encoding are permanent protocol
/// constants. A future incompatible protocol must use a different module and
/// domain rather than modifying these values.
pub const RECOVERY_DECK_DOMAIN: &[u8] = b"voided/recovery/deck";

/// Fixed AEAD domain bound to root-key recovery wrappers.
pub const RECOVERY_ROOT_WRAP_DOMAIN: &[u8] = b"voided/recovery/deck/root-wrap";

/// Exact byte length of a canonical root-key recovery wrapper.
///
/// The wrapper uses recovery-wrapper schema 1: an encryption header, a 24-byte
/// XChaCha20 nonce, a 32-byte root ciphertext, and a 16-byte authentication tag.
pub const RECOVERY_ROOT_WRAPPER_SIZE: usize = 80;

/// Permanent card-index ordering used by the Recovery Deck protocol.
///
/// Suits are spades, hearts, diamonds, clubs. Within each suit the ranks are
/// ace, 2 through 10, jack, queen, king. These ASCII identifiers are protocol
/// values, not UI or localization strings.
pub const RECOVERY_CARD_IDS: [&str; RECOVERY_DECK_CARD_COUNT] = [
    "AS", "2S", "3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS", "AH", "2H",
    "3H", "4H", "5H", "6H", "7H", "8H", "9H", "10H", "JH", "QH", "KH", "AD", "2D", "3D", "4D",
    "5D", "6D", "7D", "8D", "9D", "10D", "JD", "QD", "KD", "AC", "2C", "3C", "4C", "5C", "6C",
    "7C", "8C", "9C", "10C", "JC", "QC", "KC",
];

/// A validated 52-card permutation.
///
/// The internal byte values are indices into [`RECOVERY_CARD_IDS`]. The type
/// redacts debug output and zeroizes its order on drop because the order is the
/// recovery secret.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct RecoveryDeck {
    cards: [u8; RECOVERY_DECK_CARD_COUNT],
}

impl RecoveryDeck {
    /// Parse and validate an ordered sequence of canonical ASCII card IDs.
    pub fn from_card_ids<S: AsRef<str>>(card_ids: &[S]) -> Result<Self> {
        if card_ids.len() != RECOVERY_DECK_CARD_COUNT {
            return Err(invalid_deck(format!(
                "expected exactly {RECOVERY_DECK_CARD_COUNT} cards, got {}",
                card_ids.len()
            )));
        }

        let mut cards = [0u8; RECOVERY_DECK_CARD_COUNT];
        let mut seen = 0u64;
        for (position, card_id) in card_ids.iter().enumerate() {
            let card_id = card_id.as_ref();
            let card_index = RECOVERY_CARD_IDS
                .iter()
                .position(|candidate| *candidate == card_id)
                .ok_or_else(|| {
                    invalid_deck(format!("unknown card identifier at position {position}"))
                });
            let card_index = match card_index {
                Ok(card_index) => card_index,
                Err(error) => {
                    cards.zeroize();
                    seen.zeroize();
                    return Err(error);
                }
            };
            let bit = 1u64 << card_index;
            if seen & bit != 0 {
                cards.zeroize();
                seen.zeroize();
                return Err(invalid_deck(format!(
                    "duplicate card identifier at position {position}"
                )));
            }
            seen |= bit;
            cards[position] = card_index as u8;
        }

        seen.zeroize();
        Ok(Self { cards })
    }

    /// Return the ordered canonical card IDs without allocating card strings.
    pub fn card_ids(&self) -> impl ExactSizeIterator<Item = &'static str> + '_ {
        self.cards
            .iter()
            .map(|card| RECOVERY_CARD_IDS[*card as usize])
    }

    /// Return the validated protocol indices in secret deck order.
    pub fn as_indices(&self) -> &[u8; RECOVERY_DECK_CARD_COUNT] {
        &self.cards
    }
}

impl core::fmt::Debug for RecoveryDeck {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("RecoveryDeck")
            .field("cards", &"[REDACTED; 52]")
            .finish()
    }
}

/// Fresh recovery setup output.
///
/// The deck must be shown to the user and then discarded. Only `root_wrapper`
/// is suitable for persistence.
pub struct RecoveryDeckSetup {
    /// Fresh cryptographically shuffled recovery deck.
    pub deck: RecoveryDeck,
    /// Authenticated wrapper around the unchanged stable root key.
    pub root_wrapper: Vec<u8>,
}

impl core::fmt::Debug for RecoveryDeckSetup {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("RecoveryDeckSetup")
            .field("deck", &"[REDACTED; 52]")
            .field("root_wrapper_length", &self.root_wrapper.len())
            .finish()
    }
}

/// Generate a uniformly shuffled recovery deck using the operating system CSPRNG.
pub fn generate_recovery_deck() -> RecoveryDeck {
    let mut cards = [0u8; RECOVERY_DECK_CARD_COUNT];
    for (index, card) in cards.iter_mut().enumerate() {
        *card = index as u8;
    }
    cards.shuffle(&mut rand::rngs::OsRng);
    RecoveryDeck { cards }
}

/// Validate an ordered sequence of canonical ASCII card IDs.
pub fn validate_recovery_deck<S: AsRef<str>>(card_ids: &[S]) -> Result<()> {
    let deck = RecoveryDeck::from_card_ids(card_ids)?;
    drop(deck);
    Ok(())
}

/// Encode a recovery deck as its fixed-width, big-endian permutation rank.
///
/// This is a Lehmer-code rank in the range `0..52!`. The canonical ordered
/// deck encodes to 29 zero bytes. No two valid decks encode to the same value.
pub fn encode_recovery_deck(deck: &RecoveryDeck) -> [u8; RECOVERY_DECK_ENCODING_SIZE] {
    let mut rank = [0u8; RECOVERY_DECK_ENCODING_SIZE];
    let mut remaining = [0u8; RECOVERY_DECK_CARD_COUNT];
    for (index, card) in remaining.iter_mut().enumerate() {
        *card = index as u8;
    }

    let mut remaining_len = RECOVERY_DECK_CARD_COUNT;
    for &card in deck.cards.iter() {
        let digit = remaining[..remaining_len]
            .iter()
            .position(|candidate| *candidate == card)
            .expect("RecoveryDeck invariants guarantee every card remains");
        multiply_add_big_endian(&mut rank, remaining_len as u8, digit as u8);
        remaining.copy_within(digit + 1..remaining_len, digit);
        remaining_len -= 1;
    }
    remaining.zeroize();
    rank
}

/// Deterministically derive the 256-bit Recovery Key for a deck.
///
/// HKDF-SHA256 formats the deck's approximately 225.58 bits of entropy as a
/// Voided key. It does not increase that entropy. The rank bytes are wiped as
/// soon as derivation completes.
pub fn derive_recovery_key(deck: &RecoveryDeck) -> Result<Key> {
    let mut encoded = encode_recovery_deck(deck);
    let result = encryption::derive_key_hkdf(&encoded, None, RECOVERY_DECK_DOMAIN);
    encoded.zeroize();
    result
}

/// Authentically wrap a stable 256-bit user/account root with a Recovery Key.
///
/// The returned opaque wrapper may be persisted. The Recovery Key may not be.
pub fn wrap_root_with_recovery_key(root_key: &Key, recovery_key: &Key) -> Result<Vec<u8>> {
    let encrypted = encryption::encrypt(
        root_key.as_bytes(),
        recovery_key,
        Some(EncryptOptions {
            algorithm: Some(Algorithm::XChaCha20Poly1305),
            aad: Some(RECOVERY_ROOT_WRAP_DOMAIN.to_vec()),
        }),
    )?;
    let wrapper = encrypted.to_bytes();
    debug_assert_eq!(wrapper.len(), RECOVERY_ROOT_WRAPPER_SIZE);
    Ok(wrapper)
}

/// Unwrap a stable root key using a reconstructed Recovery Key.
pub fn unwrap_root_with_recovery_key(root_wrapper: &[u8], recovery_key: &Key) -> Result<Key> {
    if root_wrapper.len() != RECOVERY_ROOT_WRAPPER_SIZE {
        return Err(Error::InvalidKeyFormat(format!(
            "recovery root wrapper must contain exactly {RECOVERY_ROOT_WRAPPER_SIZE} bytes"
        )));
    }
    let encrypted = EncryptionResult::from_bytes(root_wrapper)?;
    if encrypted.algorithm != Algorithm::XChaCha20Poly1305
        || encrypted.ciphertext.len() != Key::SIZE
    {
        return Err(Error::InvalidKeyFormat(
            "recovery root wrapper has an invalid algorithm or payload length".to_string(),
        ));
    }
    let mut root_bytes =
        encryption::decrypt_with_aad(&encrypted, recovery_key, RECOVERY_ROOT_WRAP_DOMAIN)?;
    let root_key = Key::from_bytes(&root_bytes);
    root_bytes.zeroize();
    root_key
}

/// Generate a fresh deck and wrap an existing stable root key with it.
pub fn create_recovery_deck(root_key: &Key) -> Result<RecoveryDeckSetup> {
    let deck = generate_recovery_deck();
    let recovery_key = derive_recovery_key(&deck)?;
    let root_wrapper = wrap_root_with_recovery_key(root_key, &recovery_key)?;
    Ok(RecoveryDeckSetup { deck, root_wrapper })
}

/// Replace a recovery deck while preserving the exact stable root key.
///
/// Rotation always generates a wholly new CSPRNG permutation. It never mutates
/// the old deck and does not rotate application keys or re-encrypt user data.
pub fn rotate_recovery_deck(
    old_root_wrapper: &[u8],
    old_deck: &RecoveryDeck,
) -> Result<RecoveryDeckSetup> {
    let old_recovery_key = derive_recovery_key(old_deck)?;
    let root_key = unwrap_root_with_recovery_key(old_root_wrapper, &old_recovery_key)?;
    create_recovery_deck(&root_key)
}

fn invalid_deck(message: String) -> Error {
    Error::InvalidKeyFormat(format!("invalid recovery deck: {message}"))
}

fn multiply_add_big_endian(
    value: &mut [u8; RECOVERY_DECK_ENCODING_SIZE],
    multiplier: u8,
    addend: u8,
) {
    let mut carry = addend as u16;
    for byte in value.iter_mut().rev() {
        let product = (*byte as u16) * (multiplier as u16) + carry;
        *byte = product as u8;
        carry = product >> 8;
    }
    debug_assert_eq!(carry, 0, "52! must fit in 29 bytes");
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn canonical_ids() -> Vec<&'static str> {
        RECOVERY_CARD_IDS.to_vec()
    }

    #[test]
    fn canonical_deck_has_zero_rank_and_stable_key() {
        let deck = RecoveryDeck::from_card_ids(&canonical_ids()).unwrap();
        assert_eq!(
            encode_recovery_deck(&deck),
            [0u8; RECOVERY_DECK_ENCODING_SIZE]
        );
        assert_eq!(
            hex::encode(derive_recovery_key(&deck).unwrap().as_bytes()),
            "7d819b1d9cb4a0346a7e03a505e9bc6ef738518aa91ce99b04a866e436efd95c"
        );
    }

    #[test]
    fn validation_rejects_wrong_size_unknowns_and_duplicates() {
        let mut short = canonical_ids();
        short.pop();
        assert!(validate_recovery_deck(&short).is_err());

        let mut unknown = canonical_ids();
        unknown[0] = "A♠";
        assert!(validate_recovery_deck(&unknown).is_err());

        let mut duplicate = canonical_ids();
        duplicate[51] = "AS";
        assert!(validate_recovery_deck(&duplicate).is_err());
    }

    #[test]
    fn permutation_rank_is_deterministic_and_collision_free_for_nearby_decks() {
        let canonical = RecoveryDeck::from_card_ids(&canonical_ids()).unwrap();
        let mut swapped_ids = canonical_ids();
        swapped_ids.swap(50, 51);
        let swapped = RecoveryDeck::from_card_ids(&swapped_ids).unwrap();

        assert_eq!(
            encode_recovery_deck(&canonical),
            encode_recovery_deck(&canonical)
        );
        assert_ne!(
            encode_recovery_deck(&canonical),
            encode_recovery_deck(&swapped)
        );
        let mut expected = [0u8; RECOVERY_DECK_ENCODING_SIZE];
        expected[RECOVERY_DECK_ENCODING_SIZE - 1] = 1;
        assert_eq!(encode_recovery_deck(&swapped), expected);
    }

    #[test]
    fn reverse_deck_has_the_permanent_maximum_rank() {
        let mut reversed_ids = canonical_ids();
        reversed_ids.reverse();
        let reversed = RecoveryDeck::from_card_ids(&reversed_ids).unwrap();

        assert_eq!(
            hex::encode(encode_recovery_deck(&reversed)),
            "02fde529a3274c649cfeb4b180adb5cb9602a9e0638ab1ffffffffffff"
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn arbitrary_permutations_are_deterministic_and_order_sensitive(
            sort_keys in prop::collection::vec(any::<u64>(), RECOVERY_DECK_CARD_COUNT),
            swap_position in 0usize..(RECOVERY_DECK_CARD_COUNT - 1),
        ) {
            let mut indexed: Vec<(u64, usize)> = sort_keys
                .into_iter()
                .enumerate()
                .map(|(index, key)| (key, index))
                .collect();
            indexed.sort_unstable();
            let ids: Vec<&str> = indexed
                .iter()
                .map(|(_, index)| RECOVERY_CARD_IDS[*index])
                .collect();
            let deck = RecoveryDeck::from_card_ids(&ids).unwrap();
            let encoded = encode_recovery_deck(&deck);
            let first_key = derive_recovery_key(&deck).unwrap();
            let second_key = derive_recovery_key(&deck).unwrap();

            prop_assert_eq!(encoded, encode_recovery_deck(&deck));
            prop_assert_eq!(first_key.as_bytes(), second_key.as_bytes());

            let mut swapped_ids = ids;
            swapped_ids.swap(swap_position, swap_position + 1);
            let swapped = RecoveryDeck::from_card_ids(&swapped_ids).unwrap();
            let swapped_key = derive_recovery_key(&swapped).unwrap();
            prop_assert_ne!(encoded, encode_recovery_deck(&swapped));
            prop_assert_ne!(first_key.as_bytes(), swapped_key.as_bytes());
        }
    }

    #[test]
    fn wrapper_round_trip_authenticates_deck_and_ciphertext() {
        let root = Key::from_bytes(&[0x5au8; Key::SIZE]).unwrap();
        let deck = RecoveryDeck::from_card_ids(&canonical_ids()).unwrap();
        let recovery_key = derive_recovery_key(&deck).unwrap();
        let wrapper = wrap_root_with_recovery_key(&root, &recovery_key).unwrap();
        let recovered = unwrap_root_with_recovery_key(&wrapper, &recovery_key).unwrap();
        assert_eq!(recovered.as_bytes(), root.as_bytes());

        let mut tampered = wrapper.clone();
        tampered[40] ^= 1;
        assert!(unwrap_root_with_recovery_key(&tampered, &recovery_key).is_err());

        let mut wrong_ids = canonical_ids();
        wrong_ids.swap(0, 1);
        let wrong_deck = RecoveryDeck::from_card_ids(&wrong_ids).unwrap();
        let wrong_key = derive_recovery_key(&wrong_deck).unwrap();
        assert!(unwrap_root_with_recovery_key(&wrapper, &wrong_key).is_err());
    }

    #[test]
    fn every_wrapper_byte_is_authenticated_and_malformed_lengths_are_rejected() {
        let root = Key::from_bytes(&[0x3cu8; Key::SIZE]).unwrap();
        let deck = RecoveryDeck::from_card_ids(&canonical_ids()).unwrap();
        let recovery_key = derive_recovery_key(&deck).unwrap();
        let wrapper = wrap_root_with_recovery_key(&root, &recovery_key).unwrap();

        for index in 0..wrapper.len() {
            let mut tampered = wrapper.clone();
            tampered[index] ^= 1;
            assert!(
                unwrap_root_with_recovery_key(&tampered, &recovery_key).is_err(),
                "wrapper byte {index} was not authenticated"
            );
        }

        for malformed in [
            Vec::new(),
            wrapper[..RECOVERY_ROOT_WRAPPER_SIZE - 1].to_vec(),
            {
                let mut extended = wrapper.clone();
                extended.push(0);
                extended
            },
        ] {
            assert!(unwrap_root_with_recovery_key(&malformed, &recovery_key).is_err());
        }
    }

    #[test]
    fn debug_output_redacts_deck_order() {
        let root = Key::from_bytes(&[0x7eu8; Key::SIZE]).unwrap();
        let deck = RecoveryDeck::from_card_ids(&canonical_ids()).unwrap();
        let deck_debug = format!("{deck:?}");
        assert_eq!(deck_debug, "RecoveryDeck { cards: \"[REDACTED; 52]\" }");

        let setup = create_recovery_deck(&root).unwrap();
        let setup_debug = format!("{setup:?}");
        assert_eq!(
            setup_debug,
            "RecoveryDeckSetup { deck: \"[REDACTED; 52]\", root_wrapper_length: 80 }"
        );
    }

    #[test]
    fn rotation_rewraps_the_same_root_under_a_fresh_deck() {
        let root = Key::from_bytes(&[0xa5u8; Key::SIZE]).unwrap();
        let initial = create_recovery_deck(&root).unwrap();
        let rotated = rotate_recovery_deck(&initial.root_wrapper, &initial.deck).unwrap();

        assert_ne!(initial.deck.as_indices(), rotated.deck.as_indices());
        let new_recovery_key = derive_recovery_key(&rotated.deck).unwrap();
        let recovered =
            unwrap_root_with_recovery_key(&rotated.root_wrapper, &new_recovery_key).unwrap();
        assert_eq!(recovered.as_bytes(), root.as_bytes());

        let old_recovery_key = derive_recovery_key(&initial.deck).unwrap();
        assert!(unwrap_root_with_recovery_key(&rotated.root_wrapper, &old_recovery_key).is_err());
    }
}
