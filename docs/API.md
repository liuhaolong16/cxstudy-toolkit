# 用到的接口

> 所有参数名以实测为准。`courseId` / `classId` / `personId` 在下表中简写。

## 1. 课程列表（纯 HTTP）

```
GET https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1
Cookie: <必需>
```

返回结构（关键字段）：

```
{
  "result": 1,
  "msg": "获取成功",
  "channelList": [
    {
      "key": <classId>,
      "content": {
        "cpi": <personId>,
        "studentcount": 84,
        "chatid": "327269708005377",
        "course": { "data": [ { "id": <courseId>, "name": "...", "teacherfactor": "..." } ] }
      }
    }
  ]
}
```

注意 `courseId` 在 `content.course.data[0].id`，不在 `channel` 顶层；`classId` 是 `channel.key`。这一点很容易写错。

失败特征：`{"result":0,"msg":"请重新登录","status":false}`。

## 2. 章节与进度（必须浏览器）

```
GET https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse
      ?courseid=<courseId>&clazzid=<classId>&cpi=<personId>&ut=s
Cookie: <必需>
```

页面渲染后可用：

- `document.body.innerText` 里含 `已完成任务点: X/Y`
- `[onclick*="toOld"]` 元素的 onclick 属性形如 `toOld('<courseId>', '<knowledgeId>', '<classId>',0)`

`knowledgeId` 只能从这里拿；页面的静态 HTML 里没有它（内容是 JS 渲染的）。

## 3. 知识点内容页（必须浏览器）

```
GET https://mooc1.chaoxing.com/mooc-ans/knowledge/cards
      ?clazzid=<classId>&courseid=<courseId>&knowledgeid=<knowledgeId>
      &num=0&ut=s&cpi=<personId>&mooc2=0
```

内容按任务点类型嵌在 iframe 里：

| 任务点类型 | iframe src 特征 |
|---|---|
| 视频 | `/ananas/modules/video/index.html` |
| 文档/PPT | `/ananas/modules/pdf/index.html` |
| 作业 | `/ananas/modules/work/index.html` |
| 讨论 | `/ananas/modules/insertbbs/index.html` |

视频 iframe 与外层同源（都是 `mooc1.chaoxing.com`），因此可以直接：

```js
const ifr = [...document.querySelectorAll('iframe')]
  .find(f => String(f.src).includes('modules/video'));
const video = ifr.contentDocument.querySelector('video');
```

`video.src` 是带时效签名的 CDN 地址（`?at_=...&ak_=...`），不要缓存，每次现取。

## 4. 外层跳转链（涉及 enc）

```
GET https://mooc1.chaoxing.com/visit/stucoursemiddle
      ?courseid=<courseId>&clazzid=<classId>&cpi=<personId>&ismooc2=1
→ 302 → https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu
          ?courseid=..&clazzid=..&cpi=..&enc=<服务端生成>&t=<时间戳>&...
```

**坑**：`enc` 必须用服务端 302 里给的那个。自己算的 `MD5(courseid+"&"+puid+"F0hZ~/@-4]Pv")` 是**另一个值**，拿去请求会得到「无效的参数」。详见 [RECON.md](RECON.md#enc-双轨)。

`src/api/enc.mjs` 保留了这个 md5 复刻，但只在明确需要复刻客户端链接时用。

## 5. 播放心跳上报（只观测，不构造）

页面播放时会自发请求：

```
GET https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/<uid>/<hash>
      ?clazzId=..&playingTime=<秒>&duration=<总秒>&clipTime=0_<总秒>&...
```

返回：

```json
{ "isPassed": true, "videoTimeLimit": false, "hasJobLimit": false }
```

**`isPassed: true` 不代表任务点完成**。实测中该字段为 true 时，页面上的任务点状态类始终停在 `ans-job-icon-clear`，课程级计数不增加。见 [PROGRESS-FINDINGS.md](PROGRESS-FINDINGS.md)。

本项目**不自己构造**这个请求——只让页面正常播放，由页面自己发。

## 6. 不可用的接口（记录在此，避免后来者重复踩）

| 接口 | 现象 |
|---|---|
| `specie.chaoxing.com/apis/folder/*` | `您的ip：x.x.x.x 不被允许访问` —— IP 白名单 |
| `im.chaoxing.com/apis/message/*` | `请求出错[803003]` —— 需内部参数 |
| `learn.chaoxing.com/apis/message/*` | `服务异常[50001]` |
| `*/work/list`（多种路径变体） | 404 或返回空壳页 |

作业/考试的列表在这些路径上拿不到；能从课程页 HTML 里找到的入口只有 `https://mooc1.chaoxing.com/mooc2/work/list`（需登录态且页面结构会变）。

## 鉴权判定规则

```js
// 只有跳 passport 才算掉登录；跳业务域是正常流程
const authFailed =
  (status === 302 && /passport2|passport\.chaoxing|\/login/i.test(location)) ||
  /请重新登录|请先登录/.test(body);
```

这条规则踩过坑：最初把任意 302 都判成未认证，导致课程页误报 `authenticated: false`。
