"""Turn UCI retail line items and synthetic fixtures into an AED product catalogue."""

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from io import BytesIO
import json
from random import Random
import re
from tempfile import NamedTemporaryFile
from urllib.parse import quote
from zipfile import ZipFile

from openpyxl import load_workbook

from download_datasets import RAW_DIR, WORKBOOK, download

CATEGORIES = (
    "Electronics",
    "Grocery",
    "Home & Kitchen",
    "Fashion",
    "Beauty & Personal Care",
    "Baby & Kids",
    "Toys & Games",
    "Health & Wellness",
)
GBP_TO_AED = Decimal("4.70")
TEMPLATES = (
    (("Headphones", "Wireless Headphones", 5200, 38000), ("Tablets", "Wi-Fi Tablet", 37000, 160000)),
    (("Pantry", "Pantry Selection", 350, 5800), ("Beverages", "Sparkling Juice Pack", 650, 4500)),
    (("Kitchenware", "Nonstick Cookware Set", 4500, 35000), ("Home Decor", "Ceramic Planter", 1600, 13500)),
    (("Apparel", "Cotton Everyday Shirt", 3500, 14500), ("Accessories", "Canvas Crossbody Bag", 3800, 21000)),
    (("Skin Care", "Moisturising Face Cream", 1800, 14000), ("Hair Care", "Shampoo and Conditioner Set", 1700, 11000)),
    (("Feeding", "Baby Feeding Set", 2400, 17000), ("Nursery", "Soft Nursery Blanket", 2800, 14500)),
    (("Puzzles", "Family Jigsaw Puzzle", 1800, 14500), ("Building Sets", "Building Block Set", 2800, 21000)),
    (("Fitness", "Exercise Resistance Bands", 1900, 14800), ("Wellness", "Support Cushion", 2900, 17500)),
)
KEYWORDS = (
    (0, "Electronics Accessories", r"headphone|speaker|usb|laptop|computer|mouse mat"),
    (1, "Pantry", r"edible|^tea bags?$|^chocolate bar$"),
    (4, "Personal Care", r"lip gloss|soap|bath salts|hand cream|nail file|manicure"),
    (5, "Kids Accessories", r"baby|toddler|children|childrens|kids|nursery"),
    (6, "Games", r"toy|game|jigsaw|puzzle|doll|marbles|teddy|building block"),
    (7, "Wellness", r"first aid|hot water bottle|therapy|exercise|fitness"),
    (3, "Accessories", r"scarf|necklace|bracelet|earrings|jewellery|handbag|purse|wallet|apron|gloves"),
)
CLASSIFIERS = [(CATEGORIES[index], subcategory, re.compile(rf"\b(?:{pattern})\b", re.I))
               for index, subcategory, pattern in KEYWORDS]
STOCK_CODE = re.compile(r"[0-9]{5}[A-Z]{0,3}")
DEMO_LAPTOP_SKU = "DEMO-LAPTOP-001"


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    category: str
    subcategory: str
    price: Decimal
    list_price: Decimal
    source: str
    external_id: str

    @property
    def image_url(self) -> str:
        label = quote(self.subcategory)
        return f"https://placehold.co/640x480/png?text={label}"


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def classify(name: str) -> tuple[str, str]:
    for category, subcategory, pattern in CLASSIFIERS:
        if pattern.search(name):
            return category, subcategory
    return CATEGORIES[2], "Home Accessories"


def read_source(archive_path, limit: int) -> list[tuple[str, str, str]]:
    with ZipFile(archive_path) as archive:
        workbook = load_workbook(BytesIO(archive.read(WORKBOOK)), read_only=True, data_only=True)
    try:
        rows = workbook.active.values
        header = next(rows)
        if header[:6] != ("InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice"):
            raise ValueError("Unexpected column headings in Online Retail workbook")
        products = {}
        for invoice, code, description, quantity, _, price, *_ in rows:
            code = str(code).strip().upper()
            if (
                not str(invoice).isdigit()
                or not STOCK_CODE.fullmatch(code)
                or code in products
                or not isinstance(description, str)
                or not isinstance(quantity, (int, float))
                or quantity <= 0
                or not isinstance(price, (int, float))
                or price <= 0
            ):
                continue
            name = " ".join(description.split()).strip("?")
            if len(name) < 3:
                continue
            products[code] = (code, name.title(), str(price))
            if len(products) >= limit:
                break
        return list(products.values())
    finally:
        workbook.close()


def get_source(limit: int) -> list[Product]:
    archive = download()
    cache = RAW_DIR / f"online-retail-catalogue-v1-{limit}.json"
    if cache.exists() and cache.stat().st_mtime_ns >= archive.stat().st_mtime_ns:
        rows = json.loads(cache.read_text(encoding="utf-8"))
    else:
        rows = read_source(archive, limit)
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=RAW_DIR, delete=False) as output:
            temporary = RAW_DIR / output.name
            try:
                json.dump(rows, output)
                output.close()
                temporary.replace(cache)
            finally:
                temporary.unlink(missing_ok=True)

    products = []
    for code, name, gbp_price in rows:
        price = money(Decimal(gbp_price) * GBP_TO_AED)
        if not Decimal("0.01") <= price <= Decimal("79999999.99"):
            continue
        category, subcategory = classify(name)
        products.append(Product(
            f"UCI-{code}", name, category, subcategory, price, money(price * Decimal("1.20")),
            "uci-online-retail", code,
        ))
    return products


def build_catalogue(size: int, rng: Random, synthetic_only: bool = False) -> list[Product]:
    products = []
    for number in range(1, 41):
        sku = f"DEMO-LAPTOP-{number:03d}"
        price = Decimal("3000.00") if number == 1 else Decimal(rng.randint(1500, 6000))
        products.append(Product(
            sku, f"{'FalconBook 15' if number == 1 else f'FalconBook Series {number:02d}'} Laptop",
            CATEGORIES[0], "Laptops", price, money(price * Decimal("1.12")), "synthetic", sku,
        ))

    if not synthetic_only:
        products.extend(get_source(limit=1200 if size == 2000 else 5000))

    variants = ("Classic", "Essential", "Select", "Everyday", "Premium")
    for index in range(size - len(products)):
        category_index = index % len(CATEGORIES)
        options = TEMPLATES[category_index]
        subcategory, label, low, high = options[(index // len(CATEGORIES)) % len(options)]
        sku = f"DEMO-{index + 1:05d}"
        price = Decimal(rng.randint(low, high)) / 100
        variant = variants[(index // 16) % len(variants)]
        name = f"{variant} {label} {index + 1:05d}"
        products.append(Product(
            sku, name, CATEGORIES[category_index], subcategory, price,
            money(price * Decimal("1.15")), "synthetic", sku,
        ))
    return products
