# 从同类项目学到的东西

> 记录于 2026-11-27。本项目最初是靠**逆向观察 + 反复试错**摸出来的（见 [PROGRESS-FINDINGS](PROGRESS-FINDINGS.md)），
> 后来发现社区已有成熟实现，回头对照之后修正了几处**方向性错误**。这份文档保留那些修正，
> 也保留我们的判断依据——不是说别人的都对，而是「知道别人怎么做的，才知道自己哪里绕远了」。

## 调研对象

| 项目 | ⭐ | 技术路线 | 对我们的价值 |
|---|---|---|---|
| [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing) | 3934 | Python 协议发包 | **最有参考价值**：enc 算法、任务点 API、心跳 |
| [lispringing/SuperStar](https://github.com/lispringing/SuperStar) | 631 | 云端部署 | 验证了「无需本地环境」这个需求真实存在 |
| [cxOrz/chaoxing-signin](https://github.com/cxOrz/chaoxing-signin) | 1826 | TypeScript | 签到方向，与刷课不同 |
| [pang-qin/chaoxing-toolkit](https://github.com/pang-qin/chaoxing-toolkit) | - | 油猴脚本 + 题库服务 | AI 解题、答案格式规范 |

## 修正一：`enc` 是客户端算出来的

我们当初花了 4 小时才绕出「直接链接 cards 不记账」这个坑，当时的结论是「必须从章节列表点击进入，让服务器发 enc」。

**实际机制**（来自 `api/base.py`）：

```python
def get_enc(clazzId, jobid, objectId, playingTime, duration, userid):
    return md5(
        f"[{clazzId}][{userid}][{jobid}][{objectId}][{playingTime*1000}]"
        f"[d_yHJ!$pdA~5][{duration*1000}][0_{duration}]"
    )
```

盐是 `d_yHJ!$pdA~5`。**enc 是签名，不是令牌**——它由客户端按规则算出，服务器只验证。

**这个发现的意义**：我们原来「必须点击进入」的结论是对的（浏览器路径确实要这样），但**原因是页面自己会调上报接口**，不是「服务器发 enc」。两者结果相同，机制不同——知道机制才能判断什么情况下可以不依赖浏览器。

**产出**：`src/api/job.mjs` 里的 `fetchJobs()` 现在能独立拿到 `jtoken`。

## 修正二：文档任务点是一个 GET，不是「滚到底」

**我们踩的坑**：PDF 进去了不记账，实测要进 3 次、滚到底、再停 25 秒才记上（31/40 → 32/40 是这么涨的）。

**实际机制**（`api/base.py: study_document`）：

```python
# 文档
GET https://mooc1.chaoxing.com/ananas/job/document
    ?jobid=..&knowledgeid=..&courseid=..&clazzid=..&jtoken=..
# 阅读
GET https://mooc1.chaoxing.com/ananas/job/readv2
    ?jobid=..&knowledgeid=..&jtoken=..&courseid=..&clazzid=..
```

**一个 GET 就完成。** 我们滚动只是在碰巧触发页面自己的上报逻辑——路径绕远了。

**实测对比**（2026-11-27，同一章节 `1212178167`）：

| 路径 | 耗时 |
|---|---|
| 滚到底（8 轮 × 2s）+ 停留 25s | ~41 秒 |
| API 一次 GET | **66 毫秒** |
| | **快约 620 倍** |

**产出**：`src/api/job.mjs` 的 `finishDocumentJob()` / `finishReadJob()`。
`scripts/auto-play-cdp.mjs` 里优先走 API，失败才降级到滚动。

## 修正三：有「真人属性」心跳

**我们完全没做这件事。**

（`api/base.py: _send_monitor_heartbeat`，注释原文「佐证访问行为的真人属性」）

```python
GET https://detect.chaoxing.com/api/monitor
    ?version=..&refer=..&from=&fid=..&jsoncallback=jsonp{随机}&t=..
```

这是平台自己的检测服务，正常浏览器访问章节页就会打点。我们用 CDP 驱动的真实浏览器，页面理论上自己会打点，但无人值守长时间运行时**补一条成本几乎为零**，且能在日志留下痕迹便于排查风控。

**边界**：这不承诺规避风控。心跳成功只说明打点请求被接受，不代表平台认为你是真人。

**产出**：`src/api/heartbeat.mjs` 的 `sendHeartbeat()`，`--no-heartbeat` 可关。

## 我们比它们强的地方（不能因为借鉴而丢掉）

| 我们的做法 | 同类项目的做法 | 为什么我们保留 |
|---|---|---|
| **真实浏览器（CDP）** | 协议发包 | 超星有**自定义字体反爬**（它们的 `cxsecret_font.py` + `font_decoder.py` 就是在啃这个），浏览器天然绕过 |
| **跨客户端 AI 文件协议** | 无（最多调自家 API） | 用户可能用 WorkBuddy / Claude Code / 什么都没有，文件协议是唯一公约数 |
| **MCP server** | 无 | 能被任意 Agent 编排 |
| **判据门 + 密钥扫描** | 多数没有 | 开源项目的可信度来自可验证 |

## 还没做、但值得考虑的

按价值排序，都是**能力缺口**而非 bug：

1. **题库 / AI 解题**（章节测验、作业、考试）—— 最大缺口。同类项目有两种做法：
   - 题库匹配（准确率高，要维护题库）
   - AI 解题（零部署，正确率一般）
   - **注意：这涉及「代替人答题」，性质与加速播放不同，需要使用者明确授权**
2. **外部通知**（刷完了推送到手机）
3. **`notopen_action`**（遇到未开放章节的策略：重试 / 跳过 / 问人）
4. **配置文件**（分发给非技术用户的关键）
5. **并发章节**（它们的 `jobs = 4`；我们单标签页做不到，要多开标签）

## 一条方法论

这轮最大的教训不是「学到了什么 API」，而是——

**我们靠观察黑盒行为反推机制，别人已经读到了源码级实现。在动手逆向之前，先花十分钟搜一下同类项目，可能省掉几小时的试错。**

但反过来也成立：**别人的实现是参考不是答案**。它们的协议解析要啃字体表，我们一条 `document.querySelector` 就绕过去了——**路径可以不同，只要结论各自验证过**。
