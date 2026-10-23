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

DeepSeek 没有公开的“任意金额直接捐赠”API。QQ 里发送的是主人从 DeepSeek
充值页保存到本机的支持码；捐赠者在支付页面自行确认金额和付款。

支持码只从以下目录读取：

```text
data/support/deepseek-tip-qr.{png,jpg,jpeg,webp}
```

也可以设置 `BIGFISH_DEEPSEEK_TIP_QR` 指定同目录下的文件。`data/` 已被 Git
忽略，支付码不会提交到仓库。工具只允许向 `BIGFISH_ALLOWED_GROUPS` 中的群发送。

支持行为必须说明为自愿支持 API 开销，款项进入主人的 DeepSeek API 余额，不能
承诺商品、会员、抽奖或其他回报。
