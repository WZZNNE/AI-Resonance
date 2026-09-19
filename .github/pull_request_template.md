## What and why / 改动与原因

<!-- One or two sentences. Link the issue, e.g. "Closes #123". 一两句话说明改动，并关联 issue。 -->

## How it was checked / 如何验证

<!-- Tests added or run. For UI changes, screenshots in dark + light on desktop + phone:
     node packages/web/scripts/shots.mjs --views <view> --modes dark,light --sizes desktop,mobile --out <dir> -->

## Checklist / 自查

- [ ] `pnpm check` is green and `pnpm build` succeeds.
- [ ] New behaviour has tests on real samples or hand-computed cases.
- [ ] New external facts (URLs, fields, limits, CORS, prices) are recorded in `docs/VERIFIED.md`; `docs/DESIGN.md` is
      updated if the contract changed.
- [ ] New UI text is in both `en.ts` and `zh.ts`; user-facing changes are reflected in `README.md`,
      `README.zh-CN.md` and `docs/` where relevant.
- [ ] No secrets, personal data or generated `data/` / `public/api/` files in the diff.
