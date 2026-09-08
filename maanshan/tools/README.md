# 静态语音维护

`prepare-static-speech.cjs` 从相邻的 `poems.json`、`pronunciation.json` 收集诗中字音、全部发音对比的 `focusChar + pinyin`、原诗句、对比词和听写提示。当前覆盖 202 个字音文件与 182 个固定语音文件。动态聊天继续使用运行时 TTS。

需要 Node.js 20+，以及 PATH 中的 `ffmpeg`、`ffprobe`；无 npm 依赖。在 `maanshan` 目录运行：

```sh
node tools/prepare-static-speech.cjs
node tools/prepare-static-speech.cjs --check
node tools/prepare-static-speech.cjs --reuse-only
node tools/prepare-static-speech.cjs --generate
```

- 无参数：列出覆盖范围与缺失音频，不联网、不写文件。
- `--check`：离线验证解码、时长、信号、已有报告中的哈希及多音字区别；不写文件。
- `--reuse-only`：只复用现有音频，恢复工作报告、补充缺失索引映射。缺少音频会报错，不调用 TTS。
- `--generate`：先验证并复用现有文件，仅为缺失文件调用 TTS。已有 MP3 永不覆盖；两个索引保留全部已有键值，包括已移出源资料的条目。未变化的索引保留原字节。

`MAANSHAN_AUDIO_WORK` 可指定工作报告目录，默认是系统临时目录下的 `maanshan-audio`。目录不存在会在需要写报告时创建；旧 `static-speech-generation.json`、`word-audio-generation.json` 都不是必需文件。缺少报告时以现有索引和音频为基础重新验证、复用。报告记录音频哈希和请求状态，不存密钥。

`MAANSHAN_TTS_ENDPOINT` 可覆盖接口地址，默认 `https://aiducation.asia/api/tts`。只有 `--generate` 允许请求；使用 `{ text: SSML, voice: 101015, speed: -0.25 }`。每个汉字通过 `<phoneme alphabet="py" ph="...">` 显式指定带数字声调的拼音，`ü` 写作 `v`，无标调音节使用轻声 `5`。诗句遵循课程标音，多音字分别生成。音频解码成功后才写入最终 MP3。

新增练习先更新源 JSON 的拼音；新听写词可在词条中添加 `wordPinyin`（空格分隔字符串或数组），或补充脚本内 `dictationPinyin` 表。新繁简字对补充脚本中的 `conversion` 映射。已有文本的读音发生变化时工具会拒绝默默替换，需另行明确迁移文件与索引。

运行时接口保持 `getWordAudioURL(char, pinyin)` 和 `getSpeechAudioURL(text)`，索引位于 `media/words/index.mjs`、`media/speech/index.mjs`。生成器不改写两个 helper，其缓存版本由发布时维护。完成后运行 `--check`，并随内容变化更新发布缓存版本。
