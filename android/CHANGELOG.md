# Changelog

## [3.1.0](https://github.com/rasagyavatsal/HomeoRemedica-android/compare/v3.0.0...v3.1.0) (2026-11-04)


### Features

* compact chats and send their summary with questions ([739ac46](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/739ac46ac89e09d2887bc30b25041bd2127b10a9))
* compact long chats before the next question ([840d152](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/840d152458b53e6ba02cab5d8184a7603f05b8bd))
* label what an answer is waiting on ([bd494e8](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/bd494e8ad75d69572d91e816e31fe72762208d38))
* limit questions to 4,000 characters with a counter ([d5778cd](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/d5778cddd105bf6502705a53c1418902621332ef))
* remove the disclaimer and the /clear, /quit and /exit commands ([dd84e89](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/dd84e8979d2ecbb7b614976d4921d4a945700cd2))
* show rate limits and failures with the web app's messages ([9530771](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/9530771a7c4121ccf2b96450f043d7ab2e6d6db2))
* show reference cards that open one passage at a time ([9f90630](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/9f90630c487fd729cfb0df39e2753e980fb7fd82))
* stop and retry answers ([22cb9a7](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/22cb9a725b695748c45b1594a207c107a2339179))
* welcome new chats with the animated tagline ([85ff1e1](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/85ff1e126194277afbf5006cb634f147c44e2164))


### Bug Fixes

* abort a request as soon as its coroutine is cancelled ([3c02a59](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/3c02a59d02e67688cd3d84268c33f40d8ca1bbec))
* show the stopped note under the answer text, before its references ([a9bed7c](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/a9bed7c8a9618491d9f0882767575f4975714df4))

## [3.0.0](https://github.com/rasagyavatsal/HomeoRemedica-android/releases/tag/v3.0.0) (2026-11-04)


### Features

* add a button to report answers by email ([f739797](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/f7397972c09935827b63e0d221ed2537bb9ddbc1))
* add the chat screen with the web app's layout ([96607b6](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/96607b684c926a70eb563c69486d6b895d885a79))
* add the chat view model and session-scoped conversation store ([95b71b7](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/95b71b78c98057bc54bbd7843f104ac8ba3b9d8c))
* add the HomeoRemedica API client with streamed answers ([8b08d02](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/8b08d022b6f94a8542c9caa2899c746595eb680e))
* add the web app's design system in Compose ([f2da4ef](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/f2da4efca23f3e493a8e91473118c9870f9de119))
* link numbered citations to their sources ([b1540e8](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/b1540e804b45bb8dbc7fc45b3cc3a867be9aa2af))
* parse answers as CommonMark without raw HTML ([da8af7b](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/da8af7b69608f9ff8420b588a98dd31762411a1c))
* render answers with citation chips, sources and copy ([cf736a9](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/cf736a977ee001c659247207f62026b9f82bf053))


### Bug Fixes

* link adjacent citation labels such as [1][2] ([6bb7c42](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/6bb7c429b65786a8a8aa0cf3d5d26e77460a0ee2))


### Miscellaneous Chores

* release 3.0.0 with a new Play store listing ([92c8976](https://github.com/rasagyavatsal/HomeoRemedica-android/commit/92c897667eff169d7549a2a8fcc658a76b86b418))
