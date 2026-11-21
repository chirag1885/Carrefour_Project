"""Fetch the UCI Online Retail source archive into the ignored raw-data directory."""

import hashlib
from pathlib import Path
import shutil
from tempfile import NamedTemporaryFile
from urllib.request import urlopen
from zipfile import BadZipFile, ZipFile

RAW_DIR = Path(__file__).resolve().parents[1] / "data" / "raw"
URL = "https://archive.ics.uci.edu/static/public/352/online+retail.zip"
ARCHIVE = RAW_DIR / "online-retail.zip"
WORKBOOK = "Online Retail.xlsx"


def valid_archive(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        with ZipFile(path) as archive:
            return WORKBOOK in archive.namelist() and archive.testzip() is None
    except (BadZipFile, OSError, ValueError):
        return False


def download() -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if not valid_archive(ARCHIVE):
        with NamedTemporaryFile(dir=RAW_DIR, delete=False) as output:
            temporary = Path(output.name)
            try:
                with urlopen(URL, timeout=60) as response:
                    shutil.copyfileobj(response, output)
                output.close()
                if not valid_archive(temporary):
                    raise ValueError(f"Downloaded ZIP is missing a valid {WORKBOOK}")
                temporary.replace(ARCHIVE)
            finally:
                temporary.unlink(missing_ok=True)
    return ARCHIVE


if __name__ == "__main__":
    path = download()
    with path.open("rb") as stream:
        sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    print(f"{path.relative_to(RAW_DIR.parents[1])}  sha256:{sha256}")
    print("Daqing Chen, Online Retail (UCI), CC BY 4.0. See DATA_SOURCES.md.")
