#!/usr/bin/env python3
"""把 docs/demo/frames/*.png 合成为 README 使用的 switchboard-tour.gif。

用法：python3 docs/demo/make_gif.py   （需要 Pillow；帧由 shoot.mjs 生成）
参数：宽度 1120px、每帧 1.6–3.2s、128 色 adaptive palette，产物目标 < 5 MB。
"""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES_DIR = os.path.join(HERE, "frames")
DEST = os.path.join(HERE, "switchboard-tour.gif")

W, SHOT_H, CAP_H = 1120, 700, 76
H = SHOT_H + CAP_H
BG = (13, 20, 34)
ACCENT = (45, 212, 191)
FG = (226, 232, 240)
MUTED = (148, 163, 184)

CN_FONT = "/System/Library/Fonts/PingFang.ttc"  # macOS；其他平台替换为本地中文字体


def font(size, index=1):
    for candidate in (CN_FONT, "/System/Library/Fonts/STHeiti Light.ttc"):
        try:
            return ImageFont.truetype(candidate, size, index=index)
        except Exception:
            continue
    return ImageFont.load_default()


F_SUB = font(28, 1)
F_CAP = font(26, 0)
F_SMALL = font(22, 1)


def canvas():
    return Image.new("RGB", (W, H), BG)


def caption_bar(d, text):
    d.rectangle([0, SHOT_H, W, H], fill=(17, 26, 43))
    d.ellipse([26, SHOT_H + CAP_H // 2 - 5, 36, SHOT_H + CAP_H // 2 + 5], fill=ACCENT)
    d.text((52, SHOT_H + CAP_H // 2), text, font=F_CAP, fill=FG, anchor="lm")


def shot_frame(name, caption):
    path = os.path.join(FRAMES_DIR, name)
    if not os.path.exists(path):
        sys.exit(f"缺少帧 {path}，请先运行 docs/demo/shoot.mjs")
    im = Image.open(path).convert("RGB").resize((W, SHOT_H), Image.LANCZOS)
    img = canvas()
    img.paste(im, (0, 0))
    caption_bar(ImageDraw.Draw(img), caption)
    return img


def title_card():
    img = canvas()
    d = ImageDraw.Draw(img)
    d.line([(0, H - 130), (W, H - 130)], fill=(30, 41, 59), width=2)
    d.text((W // 2, H // 2 - 150), "Switchboard", font=font(82, 0), fill=FG, anchor="mm")
    d.text((W // 2, H // 2 - 74), "自托管 AI 模型路由网关", font=font(36, 0), fill=ACCENT, anchor="mm")
    d.text((W // 2, H // 2 - 26), "Self-hosted AI Gateway & Model Router", font=F_SMALL, fill=MUTED, anchor="mm")
    chips = ["六种路由策略 · 故障转移与熔断", "多租户 · API Key 配额 · 审计", "模型实验室 · 图/音/视频"]
    widths = [d.textlength(c, font=F_SMALL) + 44 for c in chips]
    x = (W - (sum(widths) + 16 * (len(chips) - 1))) // 2
    for c, w in zip(chips, widths):
        d.rounded_rectangle([x, H // 2 + 40, x + w, H // 2 + 92], radius=24, fill=(30, 41, 59))
        d.text((x + w // 2, H // 2 + 66), c, font=F_SMALL, fill=FG, anchor="mm")
        x += w + 16
    d.text((W // 2, H - 92), "一个入口，连接模型世界 · One API for every provider", font=F_SUB, fill=FG, anchor="mm")
    return img


def end_card():
    img = canvas()
    d = ImageDraw.Draw(img)
    d.text((W // 2, H // 2 - 160), "5 分钟跑通", font=font(54, 0), fill=ACCENT, anchor="mm")
    for i, c in enumerate(["git clone chensl139-ok/switchboard-ai-router", "npm run setup", "docker compose up -d --build"]):
        y = H // 2 - 84 + i * 56
        d.text((W // 2 - 330, y), "$", font=F_SUB, fill=(74, 222, 128), anchor="lm")
        d.text((W // 2 - 296, y), c, font=font(26, 1), fill=FG, anchor="lm")
    d.line([(0, H - 178), (W, H - 178)], fill=(30, 41, 59), width=2)
    d.text((W // 2, H - 128), "github.com/chensl139-ok/switchboard-ai-router", font=F_SUB, fill=FG, anchor="mm")
    d.text((W // 2, H - 76), "MIT License · Docker amd64/arm64 · macOS 桌面版", font=F_SMALL, fill=MUTED, anchor="mm")
    return img


frames = [
    (title_card(), 2600),
    (shot_frame("01-setup.png", "① 五分钟部署 · 创建管理员账户"), 1700),
    (shot_frame("03-providers.png", "② 服务商与模型 · 地址加密钥即完成接入"), 1700),
    (shot_frame("04-routing.png", "③ 路由策略 · 六种策略 · 熔断与超时保护"), 1700),
    (shot_frame("05-playground.png", "④ 模型实验室 · 对话与多模型对比"), 1700),
    (shot_frame("06-media.png", "⑤ 媒体实验室 · 图片 / 语音 / 视频 / 视觉理解"), 1700),
    (shot_frame("07-keys.png", "⑥ 业务 API Key · 有效期与配额"), 1700),
    (shot_frame("08-analytics.png", "⑦ 用量分析 · 成功率 · 费用估算"), 1700),
    (end_card(), 3200),
]
imgs = [f.convert("P", palette=Image.ADAPTIVE, colors=128) for f, _ in frames]
imgs[0].save(DEST, save_all=True, append_images=imgs[1:], loop=0,
             duration=[d for _, d in frames], optimize=True, disposal=1)
print("saved", DEST, os.path.getsize(DEST) / 1e6, "MB", len(imgs), "frames")
