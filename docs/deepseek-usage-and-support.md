# DeepSeek 余额、Token 与支持码

## 余额

`bigfish_deepseek_usage` 使用 DeepSeek 官方接口：

```text
GET https://api.deepseek.com/user/balance
```

它读取 `.env` 中的 `DEEPSEEK_API_KEY`，只对主人开放。返回内容包括：

- API 钱包总余额
- 赠送余额
- 充值余额
- 币种和可用状态

## Token

DSH 的 `@deepseek-ai/dsh-token-meter` 已经由基础 profile 挂载。支持码工具会读取
`DSH_HOME/storages/session_projcache/sessions/*.json` 中持久化的 `tokenUsage`
projection，并汇总所有本地会话的：

- 未缓存输入 token
- 输出 token
- 缓存读取 token
- 缓存写入 token
- 总量

同时读取当前会话的 `contextPressure`。这些是 provider-reported 持久化统计；
上下文占用估算会单独标注，不能当作账单。

## 支持码

DeepSeek 没有公开的“任意金额直接捐赠”API。`bigfish_support_deepseek` 会
在收到支持请求时用持久 Edge profile 现场打开官方充值页，选择支持的金额
`10/20/50/100/300/500` 元，点击“去支付”，只截取新生成的支付宝付款二维码
并发到当前白名单群。默认 10 元。二维码是短时订单码，过期后必须重新请求。
截图保存在 `data/support/generated/`，十分钟后自动清理。

如果 DeepSeek 登录过期，群里只会收到“暂时不可用”，不会暴露登录二维码。
主人在私聊调用 `bigfish_deepseek_login` 后，工具会把最新的官方微信登录码
私聊发给主人。扫码登录一次后，后续支持请求继续复用持久浏览器会话。

工具只允许向 `BIGFISH_ALLOWED_GROUPS` 中的群发送充值页面。`data/` 已被 Git
忽略，登录状态、页面截图和支付信息不会提交到仓库。

支持行为必须说明为自愿支持 API 开销，款项进入主人的 DeepSeek API 余额，不能
承诺商品、会员、抽奖或其他回报。
