# 任务点完成判定：实测结论

> 2026-11-26。清样本机实测，结论对是否发布本项目起决定性作用。

## 一句话结论

**无头（及有头屏幕外）播放 + 页面自发心跳上报，可以让视频真实播放，但无法让学习通把任务点标记为「已完成」。**

因此：`cxstudy play` 是一个**真实播放器**，不是一个「刷课器」。任何宣称"能刷完一学期"的说法都与实测不符。

## 实验设计

样本：`WPS-2024`（courseId 246180456 / classId 106042289），知识点 1.1（knowledgeId 906664402），视频时长 131.5s。

对照组与变量：

| 变量 | 取值 |
|---|---|
| 浏览器模式 | `--headless=new` / 有头但窗口置于屏幕外 (`--window-position=-2500,-2500`) |
| 播放终点 | `currentTime >= duration-1` / 真正触发 `ended` 事件 |
| 静音 | 全部静音（`muted` + `volume=0` + `--mute-audio`） |
| 自动播放策略 | `--autoplay-policy=no-user-gesture-required` |

## 观测结果

四种组合，结论一致：

```
BEFORE  {"clear":1,"finish":0,"cls":["ans-job-icon ans-job-video ans-job-icon-clear "]}
play: ok
  t=131/132
  >>> video ENDED event fired
AFTER   {"clear":1,"finish":0,"cls":["ans-job-icon ans-job-video ans-job-icon-clear "]}
```

上报确实发出且被接受（含真正 ended 那次）：

```
pt=0    {"isPassed":true,"videoTimeLimit":false,"hasJobLimit":false}
pt=17   {"isPassed":true,"videoTimeLimit":false,"hasJobLimit":false}
pt=17   {"isPassed":true,"videoTimeLimit":false,"hasJobLimit":false}
pt=77   {"isPassed":true,"videoTimeLimit":false,"hasJobLimit":false}
pt=131  {"isPassed":true,"videoTimeLimit":false,"hasJobLimit":false}
```

课程章节页的「已完成任务点」计数在完整播放前后**同样不变**（26/84 → 26/84）。

## 被排除的三个假设

| 假设 | 实验 | 结果 |
|---|---|---|
| A. 无头浏览器被检测，上报被静默丢弃 | 换有头、窗口移到屏幕外重跑 | 同样不变 → **排除** |
| B. 需要真正触发 `ended` 而非接近片尾 | 改为等待 `v.ended === true` 再检查 | 仍然 clear → **排除** |
| C. 播放中丢了焦点/被节流导致时长不足 | 加 `--disable-background-timer-throttling` 等四项防节流 | `currentTime` 每 8s 稳定推进 → **排除** |

## 对 `isPassed` 的判定

`{"isPassed":true}` **不是「任务点完成」**，而是「本次心跳通过校验」。

依据：该字段为 `true` 的同时，页面上的任务点状态类始终停留在 `ans-job-icon-clear`，且课程级计数不增加。若 `isPassed` 表示完成，两者应同步变化。

## 客户端侧无法进一步推进的原因

完成判定发生在服务端，客户端只提交观看位置。以下条件均不在客户端可控范围：

- 教师端为该知识点配置的完成条件（页面 title 显示「观看时长需 ≥ 总时长的 90%」，已达 100%，仍不通过）
- 服务端是否存在累计口径要求（分多次、分散观看）
- 是否需要额外的「学习完成」提交动作（本工具不构造任何写接口请求，也不打算构造）

## 因此

1. `progress` 门**恒红**，并在输出里带上前后读数与取样时刻。
2. README 与 `DISCLAIMER.md` 必须在显眼位置写明本条结论。
3. 不允许在任何文案里出现「刷课」「刷完」「一晚上搞定」等表述。
4. 若后续有人打通了完成判定，**属于超出本工具边界的行为**，本项目不提供、不背书。

## 复现方法

```bash
# 需要先有有效 cookie
node .cxstudy-re/phase0-headed.cjs 9351 headed     # 有头屏幕外
node .cxstudy-re/phase0-headed.cjs 9351 headless   # 无头
```

判定标准：`AFTER` 中 `finish` 是否 > 0，以及课程页「已完成任务点」分母是否变化。
