# 肥鱼 / 打饭机 素材说明

游戏页「喂肥鱼」的画面全部由图片素材组成。这里记录每一张的来路，
以及使用上的限制 —— 换素材时一并更新。

## 1. 角色动画（public/pet/*.webm）

| 文件 | 用途 | 来源 |
|---|---|---|
| `idle.webm` | 待机 | 「待机呼吸休闲」 |
| `eating.webm` | 吃白饭 | 「吃白饭」 |
| `happy.webm` | 打满一碗的开心 | 「点击回应-开心跃动」 |
| `hungry.webm` | 饿了 / 宽限期 | 「工作状态-垂头叹气冒汗」 |
| `troubled.webm` | 答错 / 被吃掉 | 「被吓一跳」 |

- **来源**：`D:\dsh-pet-standalone-webm-chat\_internal\assets\characters\shenshen\videos\`
- **规格**：640×360 / 24fps / VP9-alpha 透明 webm
- **署名**：角色 OC「溟月」出自画师上善无形，素材由社区成员整理；
  原仓库 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，
  按 CC BY-NC-SA 类条款发布，**仅限个人非商业使用**，不得用于任何商业/盈利场景。
  本项目是个人本地背单词工具，符合该限制。

## 2. 音效（public/pet/*.wav）

| 文件 | 用途 |
|---|---|
| `click.wav` | 界面点击 |
| `bowl.wav` | 吃一碗 |
| `error.wav` | 答错 |
| `start.wav` | 开局 |

来源同上（`assets/sounds/`）。打饭、装满、宽限期提示这几个短音是
`src/ui/game/sfx.ts` 里用 Web Audio 现场合成的，不占文件、无版权风险。

## 3. 道具（public/pet/props/*.webp）

| 文件 | 用途 |
|---|---|
| `machine.webp` | 打饭机 |
| `bowl.webp` | 一碗冒尖的白饭 |
| `scoop.webp` | 掉进碗里的一撮饭 |

**生成方式**：文生图（hunyuan-image-alpha，1536×1024），提示词要求
「日式食堂打饭机 + 印鲸鱼的陶瓷饭碗、深藏青与白、粗描边卡通贴纸风」。
出图后用脚本把白底 flood-fill 抠成透明，再按包围盒切成两张，
最后统一缩到成品尺寸转 webp（q=90，保留 alpha）。

生成这一版花了 6.46 积分（国内区）。图片右下角带「AI生成」水印 ——
这次裁掉了，后续重出图时记得同样处理，或者换 v3 模型（更贵、无水印）。

## 4. 视觉约定

- 角色在 640×360 画布里的包围盒是 `x 207..429, y 60..332`，
  `FatFish.tsx` 用百分比放大 + 负位移把这段留白裁掉，换片不会跳位。
- 打饭机、碗、鱼都站在同一条「台面线」上：`.game-floor-inner` 的 `padding-bottom`。
- 五个词 = 一碗饭：进度靠 `.disp-gauge` 的五格灯表示，不做半满的碗
  （平面风里半满的碗很容易穿帮）。
