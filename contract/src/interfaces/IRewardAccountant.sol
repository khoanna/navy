// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRewardAccountant - Interface for conservative reward NAV accounting
/// @notice Provides conservative cached valuations of harvestable rewards without
///         conflating them with synchronous on-chain liquidity.
interface IRewardAccountant {
    /// @notice Token policy configuration for reward valuation
    struct TokenPolicy {
        address token; // Reward token address
        address feed; // Chainlink price feed for reward/USD
        bytes description; // Human-readable description
        uint8 decimals; // Token decimals
        uint256 maxAge; // Maximum feed age in seconds
        uint256 lowerBound; // Minimum price bound (inclusive)
        uint256 upperBound; // Maximum price bound (inclusive)
        uint32 haircutBps; // Haircut in basis points (e.g., 500 = 5%)
        uint256 contributionCap; // Per-token cap in USDC base units
        uint256 materialityThreshold; // Cache value threshold for material status
        uint256 cacheLifetime; // How long a refresh is valid
        address[] allowedAdapters; // Adapters that can supply this token
        bool exists;
    }

    /// @notice Cached valuation state for a token
    struct TokenCache {
        uint256 value; // USDC base units
        uint256 lastUpdated; // Timestamp
        bool isMaterial; // Whether value exceeds materiality threshold
    }

    /// @notice Set or update the token policy for a reward token
    /// @param token The reward token address
    /// @param policy The policy configuration
    function setTokenPolicy(address token, TokenPolicy calldata policy) external;

    /// @notice Remove a token policy
    /// @param token The reward token to remove
    function removeTokenPolicy(address token) external;

    /// @notice Refresh valuations for all policy tokens from given adapters
    /// @param adapters The adapter addresses to query for claimable rewards
    /// @return totalValue The total USDC value of all rewards
    function refresh(address[] calldata adapters) external returns (uint256 totalValue);

    /// @notice Get the cached reward assets value (sum of all token valuations)
    /// @return The total USDC value of cached rewards
    function cachedRewardAssets() external view returns (uint256);

    /// @notice Check if the cache is fresh enough for material share issuance
    /// @return True if cache is fresh for material issuance
    function issuanceReady() external view returns (bool);

    /// @notice Get the configuration digest of all token policies
    /// @return The digest for vault configuration binding
    function configurationDigest() external view returns (bytes32);

    /// @notice Get a specific token's cached value
    /// @param token The token address
    /// @return value The cached USDC value
    /// @return lastUpdated Timestamp of last refresh
    /// @return isMaterial Whether this is a material cache entry
    function tokenCache(address token) external view returns (uint256 value, uint256 lastUpdated, bool isMaterial);

    /// @notice Get a specific token's policy
    /// @param token The token address
    /// @return The token policy
    function tokenPolicies(address token) external view returns (TokenPolicy memory);

    /// @notice Get the sequencer grace period
    function sequencerGracePeriod() external view returns (uint256);

    /// @notice Legacy narrow hook for recognized reward assets
    function recognizedRewardAssets() external view returns (uint256);

    /// @notice Sync before share actions for conservative NAV adjustment
    /// @param issuingShares True if minting shares (reduces available), false if redeeming
    /// @return recognizedAssets The recognized asset value for this action
    function syncForShareAction(bool issuingShares) external returns (uint256 recognizedAssets);
}
