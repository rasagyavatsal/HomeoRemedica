# Changelog

## [3.0.0](https://github.com/rasagyavatsal/HomeoRemedica/compare/HomeoRemedica-v2.3.0...HomeoRemedica-v3.0.0) (2026-09-05)


### ⚠ BREAKING CHANGES

* **evaluation:** corpus.toml no longer accepts processed_directory and the pipeline no longer reads dataset/processed/*.json; configure combined_dataset instead.
* **embeddings:** evaluate and build no longer accept --project or --location and authenticate with OPENROUTER_API_KEY instead of Vertex AI. corpus.toml requires native_dimensions, pins the new model, raises model_input_limit to 32768, evaluates [768, 1536, 3072, 4096] dimensions, and points evaluation at the v3 dataset. Dimension caps in the manifest and evaluation contracts rise from 3072 to 4096, and the chat client rejects corpora built with a different embedding model.

### Features

* **embeddings:** migrate embeddings from Vertex Gemini to OpenRouter Qwen3 ([#11](https://github.com/rasagyavatsal/HomeoRemedica/issues/11)) ([8fe7fea](https://github.com/rasagyavatsal/HomeoRemedica/commit/8fe7fea4a3958100098d5865a5bb56be01150f0e))
* **evaluation:** depth-8 intent-aware metric suite on the combined corpus ([#13](https://github.com/rasagyavatsal/HomeoRemedica/issues/13)) ([99e853f](https://github.com/rasagyavatsal/HomeoRemedica/commit/99e853f7d10b37544db3552f57835f75331c90af))

## [2.3.0](https://github.com/rasagyavatsal/HomeoRemedica/compare/HomeoRemedica-v2.2.0...HomeoRemedica-v2.3.0) (2026-09-05)


### Features

* **dataset:** add combined corpus file ([#8](https://github.com/rasagyavatsal/HomeoRemedica/issues/8)) ([37ba8d6](https://github.com/rasagyavatsal/HomeoRemedica/commit/37ba8d6da43f430168747b58ff5535718b89411f))
* **evaluation:** add v3 clinical case queries ([#10](https://github.com/rasagyavatsal/HomeoRemedica/issues/10)) ([07f4082](https://github.com/rasagyavatsal/HomeoRemedica/commit/07f4082a38822a7595f530e6416a95e9db785ec8))

## [2.2.0](https://github.com/rasagyavatsal/HomeoRemedica/compare/HomeoRemedica-v2.1.1...HomeoRemedica-v2.2.0) (2026-09-04)


### Features

* publish source dataset under CC BY 4.0 ([#5](https://github.com/rasagyavatsal/HomeoRemedica/issues/5)) ([aa14cc3](https://github.com/rasagyavatsal/HomeoRemedica/commit/aa14cc34bbb15d53e3f4e2e17c1e66110059bc2f))

## [2.1.1](https://github.com/rasagyavatsal/HomeoRemedica/compare/HomeoRemedica-v2.1.0...HomeoRemedica-v2.1.1) (2026-09-04)


### Documentation

* remove retired repository references ([#3](https://github.com/rasagyavatsal/HomeoRemedica/issues/3)) ([749aa19](https://github.com/rasagyavatsal/HomeoRemedica/commit/749aa19c2a2318e04b5542ff4ce9fcd318e8a21f))

## [2.1.0](https://github.com/rasagyavatsal/HomeoRemedica/compare/HomeoRemedica-v2.0.0...HomeoRemedica-v2.1.0) (2026-09-04)


### Features

* publish complete codebase without corpus data ([#1](https://github.com/rasagyavatsal/HomeoRemedica/issues/1)) ([7a3afe6](https://github.com/rasagyavatsal/HomeoRemedica/commit/7a3afe68c1f1c36600272628bbd1862f9e4ff6e9))

## [2.0.0](https://github.com/rasagyavatsal/HomeoRemedica/compare/homeoremedica-web-v6.1.2...HomeoRemedica-v2.0.0) (2026-08-31)


### ⚠ BREAKING CHANGES

* migrate project to terminal-only chat ([#139](https://github.com/rasagyavatsal/HomeoRemedica/issues/139))
* **chat:** the /find-remedy page and web saved-case management are removed; /chat replaces the finder workflow.
* **books:** use canonical book identifiers

### Features

* add animated hero audience heading ([d74c0fa](https://github.com/rasagyavatsal/HomeoRemedica/commit/d74c0fa1e356456b9bb0877f4058d7b28e6cf69f))
* add Firestore-backed chat history sidebar ([add9f64](https://github.com/rasagyavatsal/HomeoRemedica/commit/add9f644c96a014ce67c559dd557ba6a6911b6a2))
* add Firestore-backed chat history sidebar ([1994499](https://github.com/rasagyavatsal/HomeoRemedica/commit/19944999545eab9b03627d252237e7f15c16586d))
* add password reset link and enable Firebase auth providers ([b42adf2](https://github.com/rasagyavatsal/HomeoRemedica/commit/b42adf289606072ae703d9b9a1cab68aae311e1b))
* add shared backdrop and close control to symptom search ([5780a83](https://github.com/rasagyavatsal/HomeoRemedica/commit/5780a83cf10e9e613456163f69868eacedca9581))
* add sticky contained header ([5fde2ef](https://github.com/rasagyavatsal/HomeoRemedica/commit/5fde2ef54fbafced7b66b4db210b4123ae1a9d0e))
* adopt highly curved, pill-first radius system ([f3cdd00](https://github.com/rasagyavatsal/HomeoRemedica/commit/f3cdd007469209e5a5aea1c03a04706dbf6e800f))
* adopt highly curved, pill-first radius system ([e886672](https://github.com/rasagyavatsal/HomeoRemedica/commit/e886672a529995f4108656863a2a81f3ff7dcccd))
* animate remedy finder hero preview ([1b6d1d1](https://github.com/rasagyavatsal/HomeoRemedica/commit/1b6d1d1e3a1903cd3c4a985c739b65522464b8e4))
* animate saved cases preview ([b35860e](https://github.com/rasagyavatsal/HomeoRemedica/commit/b35860e73982ef34445f0c683e95b0987a4f1aee))
* **auth:** replace settings page with change-password dialog ([b101d3a](https://github.com/rasagyavatsal/HomeoRemedica/commit/b101d3a22eb37fb93bdec8f32d2b6b72bd4ec199))
* **auth:** replace settings page with change-password dialog ([9ca06d8](https://github.com/rasagyavatsal/HomeoRemedica/commit/9ca06d883966dc3c4b74710399c12453d014e427))
* **books:** use canonical book identifiers ([4f53ce4](https://github.com/rasagyavatsal/HomeoRemedica/commit/4f53ce4ec9f3afd060071a364511d107fdf21f07))
* **branding:** adopt theme-aware logo assets ([4f62767](https://github.com/rasagyavatsal/HomeoRemedica/commit/4f62767d2e9eb84d9c408d3a9ca86768a038be7e))
* **branding:** adopt theme-aware logo assets ([f0fd5fb](https://github.com/rasagyavatsal/HomeoRemedica/commit/f0fd5fbe4f38f9836056f34618c73afa192474bf))
* **cases:** notify users about retired saved cases ([1d3ea23](https://github.com/rasagyavatsal/HomeoRemedica/commit/1d3ea235ba22d5a908b48127f98c97f70da263ca))
* **chat:** clean citations, bold starred text, and keep Show more in-bubble ([8cee626](https://github.com/rasagyavatsal/HomeoRemedica/commit/8cee62646c9a3875b393e1327644244f75e5db7f))
* **chat:** collapse long messages, fix rename dialog, and tidy the thread ([9a972ba](https://github.com/rasagyavatsal/HomeoRemedica/commit/9a972bab6dc31bd6b957da183e142450ccc4321e))
* **chat:** collapse long user messages behind a Show more toggle ([007813d](https://github.com/rasagyavatsal/HomeoRemedica/commit/007813df1614bf01868d0aa4333f10218b014fa8))
* **chat:** replace remedy finder with grounded chat ([c84d2ae](https://github.com/rasagyavatsal/HomeoRemedica/commit/c84d2ae3b866a429b670cb6477f20d7616b248b9))
* consolidate remedies repository into HomeoRemedica ([#141](https://github.com/rasagyavatsal/HomeoRemedica/issues/141)) ([b0f32ea](https://github.com/rasagyavatsal/HomeoRemedica/commit/b0f32ea89bb6d746da96841727b4a9ad6d56fd70))
* **deploy:** secure production App Hosting rollouts ([213090b](https://github.com/rasagyavatsal/HomeoRemedica/commit/213090b75358174e253a78eb974e79ed19c3da79))
* **deploy:** secure production App Hosting rollouts ([8dbb65c](https://github.com/rasagyavatsal/HomeoRemedica/commit/8dbb65c76264bea7415ec2716a2d56748dd94aa4))
* **home:** add how it works section ([ba81150](https://github.com/rasagyavatsal/HomeoRemedica/commit/ba81150b6df301648765c7e02924f663bb957456))
* **home:** add how it works section ([43835bd](https://github.com/rasagyavatsal/HomeoRemedica/commit/43835bd1cfb1cd980cc4335e65d2d8959760dfd2))
* **home:** expand books, cases, and search guidance ([3c56ac8](https://github.com/rasagyavatsal/HomeoRemedica/commit/3c56ac82a19165a7a34584d1ec2c4aab6654c9d6))
* **home:** expand books, cases, and search guidance ([ba9fa3e](https://github.com/rasagyavatsal/HomeoRemedica/commit/ba9fa3e89596ae3560aebd1fdb9287872f89d300))
* **home:** replace landing page with single hero ([57c03a4](https://github.com/rasagyavatsal/HomeoRemedica/commit/57c03a4a8c237e837122afcf1b4b463be7ae040c))
* **home:** replace landing page with single hero ([c7861e2](https://github.com/rasagyavatsal/HomeoRemedica/commit/c7861e297c128691e0707bd97d48bc7d8a4a7979))
* improve authentication and responsive previews ([0caacff](https://github.com/rasagyavatsal/HomeoRemedica/commit/0caacff36c8fd320908af228c1234d4f708ce211))
* **legal:** add terms and update privacy policy ([98d2cab](https://github.com/rasagyavatsal/HomeoRemedica/commit/98d2cab8741fa9b26b2a732720c9980dff8d7065))
* **legal:** add terms and update privacy policy ([d79f310](https://github.com/rasagyavatsal/HomeoRemedica/commit/d79f31010835e05cb2cb75757f783f0b987fbaad))
* migrate project to terminal-only chat ([#139](https://github.com/rasagyavatsal/HomeoRemedica/issues/139)) ([a3745d0](https://github.com/rasagyavatsal/HomeoRemedica/commit/a3745d06ab8baf8a2323e508db3c832ee1f20d3a))
* mobile chat layout, side-drawer history, and per-chat options ([ecfdfef](https://github.com/rasagyavatsal/HomeoRemedica/commit/ecfdfef24b65c2f205a160a1acb1579ad415aa02))
* move chat page chrome into full-bleed sidebar layout ([36ed12f](https://github.com/rasagyavatsal/HomeoRemedica/commit/36ed12f9f33cf893995b23220a4232bebc78206e))
* move chat page chrome into full-bleed sidebar layout ([1269e96](https://github.com/rasagyavatsal/HomeoRemedica/commit/1269e96ce077f903d818b1ef87524fe1e3ccb751))
* **payments:** add Dodo Payments top-up and metered chat credits ([f647ac1](https://github.com/rasagyavatsal/HomeoRemedica/commit/f647ac1753d42d84b402fe18e4a4be17c6dc59aa))
* **payments:** add Dodo Payments top-up and metered chat credits ([b0c42a7](https://github.com/rasagyavatsal/HomeoRemedica/commit/b0c42a7cccba581de122d2d9aef6df956ea91602))
* polish chat mobile layout, sidebar sheet, and chat options ([2f08333](https://github.com/rasagyavatsal/HomeoRemedica/commit/2f08333b61b38aee5dafe69213dbe77d4eb3af82))
* **rag:** add Cloud Run deployment ([7774574](https://github.com/rasagyavatsal/HomeoRemedica/commit/7774574e0daffbad1b7350d82613365940bcd018))
* **rag:** add Cloud Run deployment ([056cea2](https://github.com/rasagyavatsal/HomeoRemedica/commit/056cea2952ef0d5aa7ec0036a99d6d664d866e05))
* **rag:** add grounded chat backend ([c0ced4d](https://github.com/rasagyavatsal/HomeoRemedica/commit/c0ced4d36c1a7a8c7b96ae146b56ff1d83a521e8))
* **rag:** add grounded chat backend ([1704210](https://github.com/rasagyavatsal/HomeoRemedica/commit/170421008b3871a30c1ff930c6d06f4aa02f0b31))
* render contact popup as dropdown with email and copy icon only ([27f0837](https://github.com/rasagyavatsal/HomeoRemedica/commit/27f08378e22cf9d6e1edec88545085a2f4a2a130))
* replace contact page with contact dialog modal ([80d64c7](https://github.com/rasagyavatsal/HomeoRemedica/commit/80d64c7620f45fc72e68677b09d8e4789078d83a))
* replace contact page with dropdown contact popup ([9a53fbe](https://github.com/rasagyavatsal/HomeoRemedica/commit/9a53fbe66401b39907312c5826cf37d68cf7e034))
* rewrite site UI and remedy finder experience ([c2cb461](https://github.com/rasagyavatsal/HomeoRemedica/commit/c2cb46102db82211a0f67b3e57e3c1a94b82764b))
* simplify home page and explain saved cases ([7caf393](https://github.com/rasagyavatsal/HomeoRemedica/commit/7caf393fd2aebdb49a34a344e77e8f2ac3c98645))
* simplify home page and explain saved cases ([cf42cba](https://github.com/rasagyavatsal/HomeoRemedica/commit/cf42cba3cc346419de83580545cd708b63b2a8c2))


### Bug Fixes

* align case action buttons to the right ([96bda79](https://github.com/rasagyavatsal/HomeoRemedica/commit/96bda79d25207d1d73727ab38f7bef0ca01c9aeb))
* align hero preview with remedy finder ([20b8b9f](https://github.com/rasagyavatsal/HomeoRemedica/commit/20b8b9f561e015cc7d2244c69ad256cc9b97e946))
* **auth:** keep local Google sign-in on popup flow ([01a2800](https://github.com/rasagyavatsal/HomeoRemedica/commit/01a28003eb363d9cb5b10f5bd89907b1b99378ef))
* **auth:** keep only the account email separator in account menu ([232adad](https://github.com/rasagyavatsal/HomeoRemedica/commit/232adad3b2595a869e406c2bc8a46e4c5c4b0bb3))
* **auth:** make Google redirect sign-in reliable on App Hosting ([0c4ff9b](https://github.com/rasagyavatsal/HomeoRemedica/commit/0c4ff9b9ab4f91400355a86096f0560fc33a06eb))
* **auth:** proxy redirect helper on app origin ([a2c04a5](https://github.com/rasagyavatsal/HomeoRemedica/commit/a2c04a526e82fdef406da26e37d236e907753975))
* **auth:** require backend session before sign-in ([4057e96](https://github.com/rasagyavatsal/HomeoRemedica/commit/4057e967f2b07a9b0a104fe56471cb62fada4dc5))
* **auth:** support Google sign-in in local development ([d9b53f0](https://github.com/rasagyavatsal/HomeoRemedica/commit/d9b53f0f2e9f44b5f70754f0fb49c992bb027116))
* **auth:** use local storage persistence for redirects ([f28a479](https://github.com/rasagyavatsal/HomeoRemedica/commit/f28a47996e8a241743cbcbdae3d59f23e7a0d0e1))
* **auth:** use redirect sign-in with local persistence ([bd5b183](https://github.com/rasagyavatsal/HomeoRemedica/commit/bd5b1830e7ea8b5fc16c8c5fe7668d650a260098))
* **auth:** use session persistence for deployment test ([90f3f06](https://github.com/rasagyavatsal/HomeoRemedica/commit/90f3f0637b2a25ca34d4c54f27660fbf46b6c86e))
* auto-match remedies when symptoms change ([2d6e0e2](https://github.com/rasagyavatsal/HomeoRemedica/commit/2d6e0e20bb323ca1195a6dfb9686005b1c4069f1))
* **branding:** address review feedback ([6c065ab](https://github.com/rasagyavatsal/HomeoRemedica/commit/6c065ab73ec6813140add74259f0df3d08171f8e))
* **branding:** balance header lockup ([8ae3f0b](https://github.com/rasagyavatsal/HomeoRemedica/commit/8ae3f0b9c2a12089096192958fba365d56b24456))
* center saved cases finder link ([e5309cd](https://github.com/rasagyavatsal/HomeoRemedica/commit/e5309cd41d1925660b157fac9904c5871020fdc9))
* **chat:** bold single-star emphasis and strip orphan asterisks from answers ([ce5ba22](https://github.com/rasagyavatsal/HomeoRemedica/commit/ce5ba220c4d41f53e52b01098b60da227e580b58))
* **chat:** bound chat history list query to satisfy Firestore rules ([90cf4e9](https://github.com/rasagyavatsal/HomeoRemedica/commit/90cf4e90599c3c42a433df974c3b7a5c53ddd850))
* **chat:** keep rename dialog on-screen at short viewport heights ([2426d9b](https://github.com/rasagyavatsal/HomeoRemedica/commit/2426d9b634b93ae0086144f3e3a81d0b3af3deb5))
* **ci:** pin release-please action to commit ([2209564](https://github.com/rasagyavatsal/HomeoRemedica/commit/22095642ec2344d67c08bfc4cfd88509bc123a2b))
* **ci:** pin release-please action to commit ([3b40402](https://github.com/rasagyavatsal/HomeoRemedica/commit/3b40402afd1c44de5f8af09077e95dd27d42b5d0))
* **ci:** restore release please automation ([#142](https://github.com/rasagyavatsal/HomeoRemedica/issues/142)) ([054c62b](https://github.com/rasagyavatsal/HomeoRemedica/commit/054c62bede8dd63a342eb5d0ad2a1a1e1e782e24))
* clear stale search status when search is invalidated ([b3e3603](https://github.com/rasagyavatsal/HomeoRemedica/commit/b3e36039fb54a83dcbb1407f7c21858571e09fb1))
* contain preview overlay backdrop inside workspace ([d19e0f9](https://github.com/rasagyavatsal/HomeoRemedica/commit/d19e0f9dfbcb24ad3f3d4baef62bf9cbc9d1fe0d))
* **deploy:** configure Dodo payment secrets ([19fc285](https://github.com/rasagyavatsal/HomeoRemedica/commit/19fc2852793e395cbf3d58858c50b611a8824dc7))
* **deploy:** configure Dodo payment secrets ([1afc40f](https://github.com/rasagyavatsal/HomeoRemedica/commit/1afc40fb14d8e33a432311ba4219cd964bad05d8))
* **deps:** migrate Firebase Admin to the v14 modular API ([a905595](https://github.com/rasagyavatsal/HomeoRemedica/commit/a905595892586c6d68470384c09ee8f1a505d69d))
* **home:** address how it works review feedback ([52b7231](https://github.com/rasagyavatsal/HomeoRemedica/commit/52b7231cff87d6858103d68a14a7e09fc9c44594))
* **home:** clarify hero subcopy ([5cd5235](https://github.com/rasagyavatsal/HomeoRemedica/commit/5cd5235364fa0aa79635de2a5a425ab95fddfe62))
* **home:** clarify hero subcopy ([0a9f870](https://github.com/rasagyavatsal/HomeoRemedica/commit/0a9f8703494c09066ce422c7c0b784d266f1700d))
* **home:** clarify section guidance ([6ab0f13](https://github.com/rasagyavatsal/HomeoRemedica/commit/6ab0f13749b9050e76ed6450c160eee3831291cc))
* **home:** clarify section guidance ([fbf717f](https://github.com/rasagyavatsal/HomeoRemedica/commit/fbf717f53b2d0a0dbff78608f79afca5851ab296))
* **home:** condense and rebalance the chat preview ([e5e8119](https://github.com/rasagyavatsal/HomeoRemedica/commit/e5e81194dc65824459c1480dbd6d42539048775e))
* **home:** make the chat preview mirror the real chat thread ([c9e4fb7](https://github.com/rasagyavatsal/HomeoRemedica/commit/c9e4fb79cd8ee8de650a5c683c3a00195e2b9a7f))
* **home:** make the chat preview mirror the real chat thread ([6be0e07](https://github.com/rasagyavatsal/HomeoRemedica/commit/6be0e07be1a68e546268753b5d0a80bf0b4e4825))
* **home:** preview a real case-and-answer exchange ([8b215b7](https://github.com/rasagyavatsal/HomeoRemedica/commit/8b215b707fa43e064650c6e98b740322ca159e14))
* **home:** push the footer below the first screen ([2727158](https://github.com/rasagyavatsal/HomeoRemedica/commit/27271585ae68afe266397ee5b7ce6e3b3cdec994))
* **home:** remove saved cases subcopy ([d9967ea](https://github.com/rasagyavatsal/HomeoRemedica/commit/d9967ea999b0b082cf38e280af740a75a6049b1c))
* **home:** remove saved cases subcopy ([3d76f52](https://github.com/rasagyavatsal/HomeoRemedica/commit/3d76f5259c520f0f9690c8bb294af9683fd8904b))
* **home:** simplify hero supporting content ([eed2901](https://github.com/rasagyavatsal/HomeoRemedica/commit/eed29010c78ecd87d9fa27fd9a8eeda83e1dd1c5))
* **home:** tighten the preview to a short answer excerpt ([bec9fda](https://github.com/rasagyavatsal/HomeoRemedica/commit/bec9fdac6a67ab0d8389ddf2e1465e270c0c3cac))
* **home:** update hero heading spelling ([dfdf950](https://github.com/rasagyavatsal/HomeoRemedica/commit/dfdf9508afeeb20d47374a1b4d682ceda565167b))
* **home:** update hero heading spelling ([0bdc020](https://github.com/rasagyavatsal/HomeoRemedica/commit/0bdc02004b0954a2a5b8a5bf605aca5209bbf218))
* make hero preview responsive ([722236a](https://github.com/rasagyavatsal/HomeoRemedica/commit/722236ab2796674411412425b1fbde9a4e3b2c5a))
* **payments:** align production chat price with local ([936980c](https://github.com/rasagyavatsal/HomeoRemedica/commit/936980ce584e221558a5e92e9ecbd85e451bc227))
* **payments:** align production chat price with local ([518b3a6](https://github.com/rasagyavatsal/HomeoRemedica/commit/518b3a66207e0b8f9ae3f468785cb14a8f48d9ff))
* **payments:** stop crediting non-USD webhook amounts as USD cents ([6473ded](https://github.com/rasagyavatsal/HomeoRemedica/commit/6473deda1d53b4b43ecb5d22582232fc41315918))
* **payments:** use public origin for checkout returns ([992105e](https://github.com/rasagyavatsal/HomeoRemedica/commit/992105e33b50933c04bd9e63302e1983ea630cde))
* **payments:** use public origin for checkout returns ([0ce94a2](https://github.com/rasagyavatsal/HomeoRemedica/commit/0ce94a26c52f35e204caa8d450199c9f527b3e2a))
* polish chat composer, bubbles, and history sidebar ([39fe627](https://github.com/rasagyavatsal/HomeoRemedica/commit/39fe627b0ecc9b5f045f586d118f45f794268c9d))
* polish chat composer, bubbles, and history sidebar ([cad3fea](https://github.com/rasagyavatsal/HomeoRemedica/commit/cad3fea8a8b6fea72fc6163a9a28d1177504a1bd))
* position empty symptom search overlay below the input ([c68ad27](https://github.com/rasagyavatsal/HomeoRemedica/commit/c68ad27c1d6729f4145aed25d0dcea26e384c349))
* preserve focus during preview autoplay ([cb58ffd](https://github.com/rasagyavatsal/HomeoRemedica/commit/cb58ffdb6e04fac33d533c920dfe4a88ea7786b4))
* preserve focus during preview autoplay ([41323d7](https://github.com/rasagyavatsal/HomeoRemedica/commit/41323d74108d00a035a2d76ed4da80054350e7b9))
* **previews:** align demo inputs and case labels ([15ffeed](https://github.com/rasagyavatsal/HomeoRemedica/commit/15ffeeda16e61de0be3a9f200ac0d80e3a17ed64))
* **previews:** align demo inputs and case labels ([c971fcf](https://github.com/rasagyavatsal/HomeoRemedica/commit/c971fcf0b5aeaf8b1665e98f87d1b794887571ba))
* **previews:** deduplicate case fixtures ([93cc338](https://github.com/rasagyavatsal/HomeoRemedica/commit/93cc3382775e0ad5f654f9a64e440eb5fc771d1e))
* **previews:** match production layouts across viewports ([61462eb](https://github.com/rasagyavatsal/HomeoRemedica/commit/61462eb9a728b9121db373920458f12cac1af152))
* **previews:** match saved case workflow ([30a0fc0](https://github.com/rasagyavatsal/HomeoRemedica/commit/30a0fc0eeb9ed37f3230f614a522b72440ba9ebe))
* **previews:** match saved case workflow ([a88f4ff](https://github.com/rasagyavatsal/HomeoRemedica/commit/a88f4ff34862474259ca43f5d27c37e052a2d524))
* **previews:** remove duplicated headers ([bb18fd7](https://github.com/rasagyavatsal/HomeoRemedica/commit/bb18fd7c0b558478163ed137d284bb0d739a330b))
* **previews:** remove duplicated headers ([ce3e758](https://github.com/rasagyavatsal/HomeoRemedica/commit/ce3e758a1023d3c6043f879168fb1e8713fcee64))
* **pricing:** center pricing elements vertically ([fcfa441](https://github.com/rasagyavatsal/HomeoRemedica/commit/fcfa44137bc1a8d99176b29cef20fa51c77376c4))
* **pricing:** keep footer below the first viewport ([e48e3b7](https://github.com/rasagyavatsal/HomeoRemedica/commit/e48e3b7f801f6a844fc8be2cbeda21094220fd69))
* **pricing:** remove how-it-works section and unify account menu ([cd510f5](https://github.com/rasagyavatsal/HomeoRemedica/commit/cd510f55a6b2d1171ced725fac978c20b30787eb))
* **pricing:** remove top-up hero copy ([32d2e99](https://github.com/rasagyavatsal/HomeoRemedica/commit/32d2e9939b7566e24de1a91855fd09762bfa4e27))
* provide Firebase config during App Hosting builds ([801ab5e](https://github.com/rasagyavatsal/HomeoRemedica/commit/801ab5e8f08f6896c999ab57b0cbfb83a9ccf2f1))
* **rag:** harden Cloud Run container ([bb0ca31](https://github.com/rasagyavatsal/HomeoRemedica/commit/bb0ca3194b0e487bfac52533766ee28895d4e53e))
* remove decorative curved lines ([9b3fedb](https://github.com/rasagyavatsal/HomeoRemedica/commit/9b3fedbef7b428f1143b42b01458848d804a5a5a))
* remove decorative curved lines ([c751a0a](https://github.com/rasagyavatsal/HomeoRemedica/commit/c751a0a7055a73a35a550b5521cbce51e55564f2))
* run package scripts with node 24 ([cd87740](https://github.com/rasagyavatsal/HomeoRemedica/commit/cd8774032fd17720173f2ab370f0caae17e109c6))
* run package scripts with node 24 ([563edc2](https://github.com/rasagyavatsal/HomeoRemedica/commit/563edc25da78cd77b7f3c262749011223e1e7833))
* **security:** harden application boundaries and deployments ([#136](https://github.com/rasagyavatsal/HomeoRemedica/issues/136)) ([0878a3c](https://github.com/rasagyavatsal/HomeoRemedica/commit/0878a3cb0be86d79b05e80068a58a7e808b51b16))
* **security:** harden input validation, payments integrity, headers, Firestore rules, and chat history subscription ([8071eb7](https://github.com/rasagyavatsal/HomeoRemedica/commit/8071eb7d12ce4fa1d9d28593102ca65a8f125c54))
* **security:** harden input validation, webhook crediting, headers, and Firestore rules ([572b8f3](https://github.com/rasagyavatsal/HomeoRemedica/commit/572b8f36a3f5842c0b8fb6807a8c8bb987a00e02))
* show hero preview results with symptoms ([73f32b6](https://github.com/rasagyavatsal/HomeoRemedica/commit/73f32b68d041817296bca7ce1537cf8660f7c25f))
* show hero preview results with symptoms ([1220837](https://github.com/rasagyavatsal/HomeoRemedica/commit/1220837bd58055d798278533e0b15cf41eca8978))
* smooth hero audience layout shifts ([a7c5c1a](https://github.com/rasagyavatsal/HomeoRemedica/commit/a7c5c1a25edf27dd42389870de32ea2c5014f8ba))
* sync preview themes without reload ([2a471c1](https://github.com/rasagyavatsal/HomeoRemedica/commit/2a471c1878fbfdb79602fe313643f2749edd85a1))
* sync preview themes without reload ([d73f10c](https://github.com/rasagyavatsal/HomeoRemedica/commit/d73f10c84afd9531c5b940cf26679dceed355830))
* sync theme after local storage clear ([edbd945](https://github.com/rasagyavatsal/HomeoRemedica/commit/edbd9455bfa473097a2180f6c0ca3bcacfaf87a8))
* **ui:** refine dialogs and sign-in actions ([6d9f009](https://github.com/rasagyavatsal/HomeoRemedica/commit/6d9f0094810779aed1b64fba7c1b614fa4e3aec1))
* update homepage browser title ([0b0b85f](https://github.com/rasagyavatsal/HomeoRemedica/commit/0b0b85f739fa8751cfdb86a1823f964fe0777268))
* update homepage browser title ([df65e43](https://github.com/rasagyavatsal/HomeoRemedica/commit/df65e431482d7bc53a45f3b485a54e73a83eea18))
* use remedies database release 2026-07-27 ([ebf55f3](https://github.com/rasagyavatsal/HomeoRemedica/commit/ebf55f3849a4e4c43f206f6e6167edffb231b67b))
* use remedies database release 2026-07-27 ([072db99](https://github.com/rasagyavatsal/HomeoRemedica/commit/072db998969136fe4c3b94688b55af423d564acc))
* use remedies database release 2026-07-28 ([e9e48a6](https://github.com/rasagyavatsal/HomeoRemedica/commit/e9e48a66986844fd4d8f478f28e14bb9dfb9d2a4))
* use remedies database release 2026-07-28 ([0d5e0bc](https://github.com/rasagyavatsal/HomeoRemedica/commit/0d5e0bc8fc3e1ee160cd904a56e8a188092880a0))
* use transparent browser favicons ([b678a67](https://github.com/rasagyavatsal/HomeoRemedica/commit/b678a678c1499d5246fe8cfdf5c9ddb06d334afe))
* use transparent browser favicons ([1b95dc3](https://github.com/rasagyavatsal/HomeoRemedica/commit/1b95dc36d186056e27a27637d877ac216f9b2265))


### Documentation

* clarify migration record ([2475d70](https://github.com/rasagyavatsal/HomeoRemedica/commit/2475d701e14eea19f45e824f6eaead13e337f291))
* clarify migration record ([c23270a](https://github.com/rasagyavatsal/HomeoRemedica/commit/c23270a9a35c46884278e06aaec4cf98a00d98ca))
* clarify symptom search instructions ([5059949](https://github.com/rasagyavatsal/HomeoRemedica/commit/50599496293e99b347b159783de98b04fa7d8369))
* clarify symptom search instructions ([1908c92](https://github.com/rasagyavatsal/HomeoRemedica/commit/1908c92ac72c4c8407a307cd74d274ec597f77b7))
* explain App Hosting GitHub connection ([5484382](https://github.com/rasagyavatsal/HomeoRemedica/commit/54843821d4473425f7263ebb95e14edb71784c1d))
* **legal:** refresh privacy policy and terms for the chat-only service ([87c0c9e](https://github.com/rasagyavatsal/HomeoRemedica/commit/87c0c9e56fd42deb006ca922814ffde746402f07))
* **legal:** refresh privacy policy and terms for the chat-only service ([df7242d](https://github.com/rasagyavatsal/HomeoRemedica/commit/df7242d156bb7f2545799b12e134a19c7072811c))
* record development App Hosting deployment ([0e0f3fc](https://github.com/rasagyavatsal/HomeoRemedica/commit/0e0f3fc67e9a1a2704a4308c54be037b44fc9021))
* rewrite README for the chat-only service ([71d64a6](https://github.com/rasagyavatsal/HomeoRemedica/commit/71d64a699831096b229fee02c305aca608e38e20))
* rewrite README for the chat-only service ([a6b1396](https://github.com/rasagyavatsal/HomeoRemedica/commit/a6b13969f517651d6308a8b6ac29e218bc4edd07))
* rewrite web readme ([4d555ce](https://github.com/rasagyavatsal/HomeoRemedica/commit/4d555ce33d62d105a2aa0719636b85d8b6d630f0))
* rewrite web readme ([9f04369](https://github.com/rasagyavatsal/HomeoRemedica/commit/9f043697c6778735de4654ca0a28a041dddf896f))
