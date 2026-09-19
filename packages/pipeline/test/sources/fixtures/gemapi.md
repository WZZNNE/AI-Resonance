This page documents updates to the Gemini API.

## September 17, 2026

- **Antigravity Agent 09-2026** : Released `antigravity-preview-09-2026`,
  which replaces and deprecates `antigravity-preview-05-2026`.

  If you run on a remote sandbox (`environment: "remote"`) and read only
  `output_text` or `model_output` steps, update the agent string and nothing
  else changes.

  If you run tools locally (`local_environment`) or parse `function_call`
  steps, the built-in tools changed. Parameters use PascalCase instead of
  snake_case, and file edits use line-range replacements instead of full
  rewrites.

  | Capability | 05-2026 | 09-2026 |
  |---|---|---|
  | File creation | `write_file(path, content)` | `write_to_file(TargetFile, CodeContent, Overwrite, Description)` |
  | File editing | `write_file(path, content)`, full rewrite | `replace_file_content(TargetFile, StartLine, EndLine, TargetContent, ReplacementContent)` |
  | File reading | `read_file(path, offset, limit)`, byte offsets | `view_file(AbsolutePath, StartLine, EndLine, ContentOffset)` |
  | Directory listing | `list_files(path)` | `list_dir(DirectoryPath)` |
  | File and code search | None, agents used shell commands | `find_by_name(SearchDirectory, Pattern, MaxDepth)` and `grep_search(SearchPath, Query, IsRegex)` |
  | Shell execution | `code_execution(command, timeout_seconds)` | Unchanged |
  | Web search | `google_search(queries)` | Unchanged |

  See the [Antigravity Agent](https://ai.google.dev/gemini-api/docs/antigravity-agent) guide.
  `antigravity-preview-05-2026` shuts down on October 5, 2026, tracked on the
  [deprecations](https://ai.google.dev/gemini-api/docs/deprecations#managed-agents) page.

## September 15, 2026

- **Gemini 3.8 Live and Gemini 3.8 Live Extended Thinking generally available
  (GA)**: Released two new audio-to-audio models for real-time voice
  applications using the Live API:

  - **Gemini 3.8 Live** ([`gemini-3.8-live`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)): The default option for most low-latency voice agent experiences and real-time dialogue without reasoning delays. Features interleaved reasoning, default asynchronous function calling, and full session client content updates.
  - **Gemini 3.8 Live Extended Thinking** ([`gemini-3.8-live-extended-thinking`](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking)): High-reasoning audio-to-audio model supporting background reasoning during live audio interactions, recommended when higher background reasoning is required.

  To get started, see the [Live API guide](https://ai.google.dev/gemini-api/docs/live-api), the
  [Capabilities guide](https://ai.google.dev/gemini-api/docs/live-api/capabilities), and the
  [Thinking guide](https://ai.google.dev/gemini-api/docs/live-api/thinking).

## September 3, 2026

- **Lyria 3.5 generally available (GA)**: Released the next generation of
  Google's music generation model:

  - [`lyria-3.5`](https://ai.google.dev/gemini-api/docs/models/lyria-3.5): Full-length song generation with improved musical coherence, natural vocals, and fine-grained duration and structural control.

  The model supports text and image inputs and generates high-fidelity 44.1 kHz
  stereo audio. See the [Music generation](https://ai.google.dev/gemini-api/docs/music-generation)
  guide for details and code samples.

