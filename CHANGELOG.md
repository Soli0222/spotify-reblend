# Changelog

## [1.6.0](https://github.com/Soli0222/spotify-reblend/compare/v1.5.0...v1.6.0) (2026-08-15)


### 新機能

* **backend:** add auto update settings schema and api ([#213](https://github.com/Soli0222/spotify-reblend/issues/213)) ([da76277](https://github.com/Soli0222/spotify-reblend/commit/da762778488f70dcb19a27e3b9e1eeaf9550453f))
* **backend:** add daily auto update scheduler ([#219](https://github.com/Soli0222/spotify-reblend/issues/219)) ([99d64d9](https://github.com/Soli0222/spotify-reblend/commit/99d64d9dd64765cafe2c36d9424fe7a4e55f4753))
* **backend:** add opentelemetry tracing with auto-instrumentation ([#211](https://github.com/Soli0222/spotify-reblend/issues/211)) ([668f53d](https://github.com/Soli0222/spotify-reblend/commit/668f53d2704dc2b8f9478272916435aa090f78df))
* **backend:** add trace and span ids to structured logs ([#214](https://github.com/Soli0222/spotify-reblend/issues/214)) ([e28d432](https://github.com/Soli0222/spotify-reblend/commit/e28d432854f89ec5e07db8c0346d78cb5b7eb73f))
* **backend:** broaden instrumental track name patterns ([#217](https://github.com/Soli0222/spotify-reblend/issues/217)) ([58390c8](https://github.com/Soli0222/spotify-reblend/commit/58390c898272e4fccf721084add17b6682c345d0))
* **backend:** detect and persist revoked spotify tokens ([#216](https://github.com/Soli0222/spotify-reblend/issues/216)) ([77349d9](https://github.com/Soli0222/spotify-reblend/commit/77349d9bec8c72c5add26f3cad784c4a81137045))
* **backend:** filter out short interlude tracks from blends ([#212](https://github.com/Soli0222/spotify-reblend/issues/212)) ([74a2863](https://github.com/Soli0222/spotify-reblend/commit/74a2863aa318f8bbf8e9606a8e64875071aec07c))
* **backend:** instrument playlist generation with custom spans ([#220](https://github.com/Soli0222/spotify-reblend/issues/220)) ([47e0e8a](https://github.com/Soli0222/spotify-reblend/commit/47e0e8afb481472ad3cd0e5a5fd3ea7c774c7407))
* **ci:** rebuild the release pipeline as a DAG on shared workflows ([#195](https://github.com/Soli0222/spotify-reblend/issues/195)) ([a1e06c6](https://github.com/Soli0222/spotify-reblend/commit/a1e06c6b78fa0bf49d5d9196654c4a6ccb35a885))
* **frontend:** add auto update toggle to playlist detail ([#215](https://github.com/Soli0222/spotify-reblend/issues/215)) ([283b9cf](https://github.com/Soli0222/spotify-reblend/commit/283b9cf4af56552a0796c71c37854d521fc8e70f))
* **frontend:** surface members with revoked spotify access ([#218](https://github.com/Soli0222/spotify-reblend/issues/218)) ([55a4979](https://github.com/Soli0222/spotify-reblend/commit/55a497917e31a9192008fbfe234d2ca80d36751a))

## [1.5.0](https://github.com/Soli0222/spotify-reblend/compare/v1.4.1...v1.5.0) (2026-08-08)


### 新機能

* publish helm chart as OCI artifact from this repo ([#192](https://github.com/Soli0222/spotify-reblend/issues/192)) ([b4859d3](https://github.com/Soli0222/spotify-reblend/commit/b4859d3ff9e6909d2e510ef37adb826de2b9bb14))

## [1.4.1](https://github.com/Soli0222/spotify-reblend/compare/v1.4.0...v1.4.1) (2026-07-26)


### バグ修正・依存関係の更新

* pass repository to docker dispatch in release workflow ([#186](https://github.com/Soli0222/spotify-reblend/issues/186)) ([fe18273](https://github.com/Soli0222/spotify-reblend/commit/fe18273d4aa7d7979630f4d1192c8ffb880cec7b))
* use github app token for release automation ([#188](https://github.com/Soli0222/spotify-reblend/issues/188)) ([9b4b74f](https://github.com/Soli0222/spotify-reblend/commit/9b4b74f11f227ab7539673ecf95632ae1aeb9d72))

## [1.4.0](https://github.com/Soli0222/spotify-reblend/compare/v1.3.0...v1.4.0) (2026-07-26)


### 新機能

* automate releases with release-please ([#182](https://github.com/Soli0222/spotify-reblend/issues/182)) ([f2d0de6](https://github.com/Soli0222/spotify-reblend/commit/f2d0de62a692cd8b682090da5b3ea3c35c64ad74))


### バグ修正・依存関係の更新

* merge weekly release PR based on main branch CI ([#185](https://github.com/Soli0222/spotify-reblend/issues/185)) ([58922c1](https://github.com/Soli0222/spotify-reblend/commit/58922c134c9dbf4bceae58d775e2f83809b6880f))
* move renovate workflow into workflows directory ([dca8a39](https://github.com/Soli0222/spotify-reblend/commit/dca8a397f75dee47344c1aed7f5f77cabc94ddd8))
* pass repository to renovate ([2214737](https://github.com/Soli0222/spotify-reblend/commit/22147375198138e339c0d7ea1f7f039e87abcf85))
* use renovate app client id secret ([d4c8f0c](https://github.com/Soli0222/spotify-reblend/commit/d4c8f0c174ef5f7aed522a5fd91ac2e23945ae9b))
