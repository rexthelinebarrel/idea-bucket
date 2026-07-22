# 生成灵感桶品牌图标：琥珀桶身 + 镂空声波 + 灵感火花，墨黑底
# 产出：icon.png / android-icon-foreground.png / android-icon-background.png /
#       android-icon-monochrome.png / splash-icon.png
from PIL import Image, ImageDraw, ImageFilter

AMBER = (255, 176, 32, 255)
INK = (8, 10, 14, 255)
WHITE = (255, 255, 255, 255)
S = 1024


def draw_glyph(img: Image.Image, color, scale: float = 1.0, glow: bool = True):
    """在 S×S 画布中央绘制桶形标志。scale 相对安全区缩放。"""
    d = ImageDraw.Draw(img)

    def sc(v):
        return 512 + (v - 512) * scale

    # 灵感火花（四角星）+ 辉光
    cx, cy, r = 512, 196, 64
    if glow:
        gl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        gd = ImageDraw.Draw(gl)
        gd.ellipse([sc(cx - 130), sc(cy - 130), sc(cx + 130), sc(cy + 130)], fill=(255, 176, 32, 90))
        gl = gl.filter(ImageFilter.GaussianBlur(60))
        img.alpha_composite(gl)
    pts = [
        (sc(cx), sc(cy - r)),
        (sc(cx + r * 0.28), sc(cy - r * 0.28)),
        (sc(cx + r), sc(cy)),
        (sc(cx + r * 0.28), sc(cy + r * 0.28)),
        (sc(cx), sc(cy + r)),
        (sc(cx - r * 0.28), sc(cy + r * 0.28)),
        (sc(cx - r), sc(cy)),
        (sc(cx - r * 0.28), sc(cy - r * 0.28)),
    ]
    d.polygon(pts, fill=color)

    # 桶沿
    d.rounded_rectangle([sc(266), sc(330), sc(758), sc(414)], radius=int(42 * scale), fill=color)
    # 桶身
    d.rounded_rectangle([sc(306), sc(414), sc(718), sc(754)], radius=int(72 * scale), fill=color)
    # 镂空声波（用底色刻出三条竖条）
    bar_color = INK if color != WHITE else (0, 0, 0, 0)
    heights = [128, 196, 156]
    for i, h in enumerate(heights):
        x = 428 + i * 84
        yc = 584
        d.rounded_rectangle(
            [sc(x - 23), sc(yc - h / 2), sc(x + 23), sc(yc + h / 2)],
            radius=int(23 * scale),
            fill=bar_color,
        )


def make(path, bg, fg, scale, glow=True, pad_scale=1.0):
    img = Image.new("RGBA", (S, S), bg)
    draw_glyph(img, fg, scale, glow)
    img.save(path)
    print("OK", path)


out = "D:/rex/workshop/idea-bucket/assets/images/"

# 通用图标（全幅底 + 标志放大到 78%）
make(out + "icon.png", INK, AMBER, 1.18)
# Android 自适应：前景透明底、标志在安全区（≈62%）
make(out + "android-icon-foreground.png", (0, 0, 0, 0), AMBER, 0.98)
# Android 自适应：背景纯品牌墨黑
Image.new("RGBA", (S, S), INK).save(out + "android-icon-background.png")
print("OK android-icon-background.png")
# 单色（通知栏/主题图标用，白色剪影）
make(out + "android-icon-monochrome.png", (0, 0, 0, 0), WHITE, 0.98, glow=False)
# 启动页图标（透明底，居中 62%）
make(out + "splash-icon.png", (0, 0, 0, 0), AMBER, 0.98)
