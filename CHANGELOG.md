# Changelog

## [1.2.0](https://github.com/fidlabs/hyperion/compare/v1.1.1...v1.2.0) (2026-11-18)


### Features

* client average SLA, first onboarded date, SLA history and deals SLA ([f307d41](https://github.com/fidlabs/hyperion/commit/f307d4124b0f7d330061ff61ee7332904f1df6a1))
* client deals history ([684a53a](https://github.com/fidlabs/hyperion/commit/684a53a8b9b669c44f2a91e30ef09cdeea2fa9d3))
* per-client aggregates(payer wallet) ([e75ffad](https://github.com/fidlabs/hyperion/commit/e75ffada244e2b0187122011c3b03c042cb1901e))
* per-SP aggregates (miner ID) ([6a25d78](https://github.com/fidlabs/hyperion/commit/6a25d78de1609ea868e43151289262567893166c))
* SP non-compliant deals count by SLI indicator ([d06bee9](https://github.com/fidlabs/hyperion/commit/d06bee9447f549c5eac128c5b3914c77403b87f7))


### Bug Fixes

* guard client spend token data and return 404 for unknown client ([20c50fa](https://github.com/fidlabs/hyperion/commit/20c50fa73e9f199df2ba59f67cdcc7e272690f7e))
* index ManifestUpdated event ([65117ec](https://github.com/fidlabs/hyperion/commit/65117ec60784bb84f0f8372e7c56bb3f76d47ce1))
* make deal manifestHash required and resync indexer ([0a0d2ae](https://github.com/fidlabs/hyperion/commit/0a0d2ae7f20f48082b8114ec1ed73fd3ee907ad8))
* rail activation epoch selected as string literal ([b95d0db](https://github.com/fidlabs/hyperion/commit/b95d0dba37ca0c3d11fc2c5feb44d46aee8d4aca))
* whitelist pagination query parameters ([f3f9347](https://github.com/fidlabs/hyperion/commit/f3f93470739c5f0642eefa17bd753313c91c2e7b))


### Refactoring

* limit client detail to dashboard fields ([d741d20](https://github.com/fidlabs/hyperion/commit/d741d2032023281f3841d4edfd0aeaca5b700e56))
* limit SP economics stats to dashboard fields ([085d335](https://github.com/fidlabs/hyperion/commit/085d335d3045fb91a5256a7573d888ce26acfc53))
* limit SP storage stats to dashboard fields ([0105352](https://github.com/fidlabs/hyperion/commit/01053525ff7442710e036429f577f055037279c0))
* remove SP list ported from CDP ([635ecb9](https://github.com/fidlabs/hyperion/commit/635ecb9ce2c8411d77d8890512032f46cccf9e96))
* skip client spend and SLA queries for unknown client ([b8aa1ec](https://github.com/fidlabs/hyperion/commit/b8aa1ec483e30d012492ada3ea81c14d5025c78a))

## [1.1.1](https://github.com/fidlabs/hyperion/compare/v1.1.0...v1.1.1) (2026-11-13)


### CI

* Add release app to works with release-please action ([#24](https://github.com/fidlabs/hyperion/issues/24)) ([d39f626](https://github.com/fidlabs/hyperion/commit/d39f626b1a1c7dbe662bab59fbf95556959a54a0))

## [1.1.0](https://github.com/fidlabs/hyperion/compare/v1.0.0...v1.1.0) (2026-11-13)


### Features

* add deal type to PoRep deals ([#7](https://github.com/fidlabs/hyperion/issues/7)) ([6f647dc](https://github.com/fidlabs/hyperion/commit/6f647dc7228fc070bd270f70c5d37252c82912ea))


### Bug Fixes

* index only up to finalized tipset ([#12](https://github.com/fidlabs/hyperion/issues/12)) ([40c28c1](https://github.com/fidlabs/hyperion/commit/40c28c1f092b272fb39ef9089787c37ef3b804c8))
