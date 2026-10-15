"""生成微信小程序头像 144x144 PNG"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 144
OUT = os.path.join(os.path.dirname(__file__), "icon_144.png")

# 中文字体（Windows 常见路径）
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]

def find_font():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None

font_path = find_font()
print(f"Using font: {font_path}")

# 背景：柔和的米黄-橙色渐变（教育工具感）
img = Image.new("RGB", (SIZE, SIZE), "#F5D9A8")
draw = ImageDraw.Draw(img)

# 圆角矩形背景（覆盖全屏，圆角 24px）
bg_color = "#E8B86B"
draw.rounded_rectangle([0, 0, SIZE-1, SIZE-1], radius=28, fill=bg_color)

# 添加一点渐变质感（从上到下）
for y in range(SIZE):
    ratio = y / SIZE
    r = int(232 + (218 - 232) * ratio)
    g = int(184 + (166 - 184) * ratio)
    b = int(107 + (80 - 107) * ratio)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b))

# 主字：「字」- 大字居中
if font_path:
    font_big = ImageFont.truetype(font_path, 78)
    text = "字"
    bbox = draw.textbbox((0, 0), text, font=font_big)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) / 2 - bbox[0]
    y = (SIZE - th) / 2 - bbox[1] - 8  # 稍微上移留出底部小字空间
    # 描边效果（暗色）
    for dx, dy in [(-2,0),(2,0),(0,-2),(0,2),(-1,-1),(1,1),(-1,1),(1,-1)]:
        draw.text((x+dx, y+dy), text, fill="#8B5A2B", font=font_big)
    # 主字白色
    draw.text((x, y), text, fill="#FFFFFF", font=font_big)

# 底部小字：成语
if font_path:
    font_small = ImageFont.truetype(font_path, 22)
    text2 = "成语填空"
    bbox2 = draw.textbbox((0, 0), text2, font=font_small)
    tw2 = bbox2[2] - bbox2[0]
    x2 = (SIZE - tw2) / 2 - bbox2[0]
    y2 = SIZE - 32 - bbox2[1]
    draw.text((x2, y2), text2, fill="#FFFFFF", font=font_small)

img.save(OUT, "PNG")
print(f"Saved: {OUT}")
print(f"Size: {os.path.getsize(OUT)} bytes ({os.path.getsize(OUT)/1024:.1f} KB)")
