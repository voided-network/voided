#!/usr/bin/env node
// Compatibility entry point. The release builder is the sole build authority.
await import('./build-native-release.js');
