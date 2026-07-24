#!/usr/bin/env python3
# bum.py — Best Practice Codebase Aggregator (NestJS / TypeScript / Express / Prisma)
import os
import sys
import re
import argparse
import fnmatch
from pathlib import Path
from typing import Set, List, Tuple

# Set console output encoding to UTF-8 to prevent UnicodeEncodeError on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# =========================================================================
# CONFIGURATION CLASS (Information Expert)
# Menyimpan seluruh konfigurasi penapisan secara terpusat untuk NestJS & Node.js
# =========================================================================
class AggregatorConfig:
    DEFAULT_TARGET = str(Path(__file__).parent.resolve())
    DEFAULT_OUTPUT = f"{Path(__file__).parent.name}.txt"

    # 1. Folder Blacklist (Diabaikan secara mutlak)
    FORBIDDEN_DIRS = {
        "node_modules", ".git", "dist", "build", "out", "coverage",
        ".vscode", ".idea", ".next", ".swc", "recovered", "temp", "tmp", "geojson",
        ".nuxt", ".cache", ".parcel-cache", ".vercel", "dist-ssr", ".expo", ".yarn"
    }

    # 2. Berkas Blacklist (Diabaikan secara mutlak)
    FORBIDDEN_FILES = {
        "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
        ".DS_Store", "Thumbs.db"
    }

    # 3. Whitelist Folder yang Diizinkan untuk Ditelusuri (NestJS & Node.js Backend)
    ALLOWED_DIRS = {
        "src", "prisma", "config", "modules", "common", "controllers", "services",
        "repositories", "interfaces", "parsers", "providers", "dtos", "dto",
        "entities", "utils", "helpers", "models", "validators", "jobs", "queues",
        "migrations", "seeders", "filters", "pipes", "interceptors", "guards",
        "decorators", "adapters", "factories", "types", "enums"
    }

    # 4. Ekstensi Berkas Teks yang Diizinkan untuk Backend TypeScript / NestJS / Prisma
    INCLUDE_EXTENSIONS = {
        ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".prisma",
        ".yaml", ".yml", ".md", ".env.example", ".sh", ".sql"
    }

    # 5. Berkas Konfigurasi Wajib di Tingkat Root
    ESSENTIAL_ROOT_FILES = {
        "package.json", "tsconfig.json", "nest-cli.json", "docker-compose.yml",
        "Dockerfile", ".env.example", "schema.prisma", "index.js", "server.js",
        "app.js", "nodemon.json", "jest.config.js", ".eslintrc.js", ".eslintrc.json",
        ".prettierrc", "README.md"
    }

    # 6. Batas Maksimum Ukuran Berkas (1 MB)
    MAX_FILE_SIZE_BYTES = 1024 * 1024  

    # Pre-compiled Regex untuk Sensor Keamanan (Mencegah Kebocoran Kredensial)
    SENSITIVE_REGEX = re.compile(
        r"(\.env.*|key.*\.pem|.*\.key|id_rsa.*|credentials.*)", 
        re.IGNORECASE
    )


# =========================================================================
# OPTIMIZER CLASS (Pure Fabrication)
# Pintu gerbang optimasi konten teks dan deteksi data biner
# =========================================================================
class LLMContextOptimizer:
    @staticmethod
    def strip_js_ts_comments(text: str) -> str:
        """Menghapus komentar // dan /* ... */ secara aman tanpa merusak string literal atau Dekorator NestJS."""
        pattern = re.compile(
            r'/\*.*?\*/|//.*?$|\'(?:\\.|[^\\\'])*\'|"(?:\\.|[^\\"])*"|`(?:\\.|[^\\`])*`',
            re.DOTALL | re.MULTILINE
        )
        def replacer(match):
            s = match.group(0)
            if s.startswith('/'):
                return ""
            return s
        return re.sub(pattern, replacer, text)

    @staticmethod
    def strip_html_comments(text: str) -> str:
        """Menghapus komentar HTML <!-- ... -->."""
        return re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)

    @classmethod
    def compress_code(cls, content: str, suffix: str = "", strip_comments: bool = True) -> str:
        """Menghapus spasi trailing, baris kosong ganda, komentar, dan JSDoc/HTML comments."""
        if strip_comments:
            if suffix in (".js", ".jsx", ".ts", ".tsx", ".css", ".scss"):
                content = cls.strip_js_ts_comments(content)
            elif suffix in (".html", ".vue"):
                content = cls.strip_html_comments(content)

        lines = content.splitlines()
        optimized_lines = []
        previous_empty = False
        
        for line in lines:
            stripped = line.rstrip()
            is_empty = len(stripped) == 0
            
            if is_empty and previous_empty:
                continue
                
            optimized_lines.append(stripped)
            previous_empty = is_empty
            
        return "\n".join(optimized_lines)

    @staticmethod
    def is_binary(file_path: Path) -> bool:
        """Deteksi biner murah dengan membaca 512 byte pertama."""
        try:
            with open(file_path, 'rb') as f:
                return b'\x00' in f.read(512)
        except Exception:
            return True


# =========================================================================
# AGGREGATOR CONTROLLER (GRASP Controller)
# Orkestrator utama penelusuran dan pembangunan bundel berkas teks
# =========================================================================
class CodebaseAggregator:
    def __init__(self, target_dir: str, output_name: str, strip_comments: bool = True, exclude_tests: bool = False):
        self.config = AggregatorConfig()
        self.optimizer = LLMContextOptimizer()
        self.strip_comments = strip_comments
        self.exclude_tests = exclude_tests
        
        # Penyelarasan Portabilitas Jalur Direktori
        self.target_path = Path(target_dir).resolve()
        if not self.target_path.is_dir():
            self.target_path = Path(__file__).parent.resolve()
            print(f"[SYSTEM] Target direktori tidak ditemukan. Menggunakan fallback di: {self.target_path}")

        self.output_file = self.target_path / output_name
        self.config.FORBIDDEN_FILES.add(output_name) # Jangan biarkan skrip membaca file output-nya sendiri
        self.config.FORBIDDEN_FILES.add(Path(__file__).name) # Jangan biarkan skrip menyalin dirinya sendiri
        self.gitignore_patterns = self._parse_gitignore()

    def _parse_gitignore(self) -> List[str]:
        """Membaca berkas .gitignore sebagai daftar pola untuk pencocokan."""
        patterns = []
        gitignore_path = self.target_path / ".gitignore"
        if gitignore_path.exists():
            try:
                for line in gitignore_path.read_text("utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        patterns.append(line)
            except Exception as e:
                print(f"[WARN] Gagal mengurai .gitignore: {e}")
        return patterns

    def should_ignore(self, path: Path, is_dir: bool = False) -> bool:
        """Memeriksa apakah berkas atau folder harus diabaikan berdasarkan blacklist dan gitignore."""
        try:
            rel_path = path.relative_to(self.target_path)
        except ValueError:
            rel_path = path
            
        parts = rel_path.parts
        if not parts:
            return False

        # 1. Cek folder blacklist bawaan pada komponen path manapun
        for part in parts:
            if part in self.config.FORBIDDEN_DIRS:
                return True

        # 2. Cek berkas blacklist bawaan jika bukan direktori
        if not is_dir:
            if path.name in self.config.FORBIDDEN_FILES:
                return True
            if self.config.SENSITIVE_REGEX.match(path.name):
                return True
                
            # Filter Berkas Pengujian (Unit Test/E2E) jika parameter diaktifkan
            if self.exclude_tests:
                lower_name = path.name.lower()
                if "test" in lower_name or "spec" in lower_name:
                    if path.suffix in (".ts", ".tsx", ".js", ".jsx"):
                        return True

        # 3. Filter folder khusus pengujian secara mutlak
        if self.exclude_tests and is_dir:
            if path.name in ("tests", "__tests__", "cypress", "playwright"):
                return True

        # 4. Cek kecocokan dengan pola gitignore
        rel_path_str = rel_path.as_posix()
        
        for pattern in self.gitignore_patterns:
            clean_pattern = pattern.lstrip('/')
            is_pattern_dir = pattern.endswith('/')
            match_pattern = clean_pattern.rstrip('/')
            
            if is_pattern_dir and not is_dir:
                continue
                
            if '/' in match_pattern:
                if fnmatch.fnmatch(rel_path_str, match_pattern) or fnmatch.fnmatch(rel_path_str, f"{match_pattern}/*"):
                    return True
            else:
                if any(fnmatch.fnmatch(part, match_pattern) for part in parts):
                    return True
                    
        return False

    def execute(self):
        print(f"🔍 Memulai penggabungan kode dari target: {self.target_path}")
        if self.strip_comments:
            print("✂️ Pembersihan komentar & JSDoc diaktifkan untuk berkas TS/JS/Prisma.")
        if self.exclude_tests:
            print("🚫 Berkas pengujian (*.test.*, *.spec.*, folder tests/) diabaikan.")
            
        file_count = 0
        original_total_size = 0
        compressed_total_size = 0
        
        processed_files_stats: List[Tuple[str, int]] = []

        try:
            with open(self.output_file, "w", encoding="utf-8") as out_file:
                out_file.write("=== BRIDA SMART ANALYSIS (BACKEND CODEBASE BUNDLE) ===\n\n")

                for root, dirs, files in os.walk(self.target_path):
                    root_path = Path(root)
                    relative_root = root_path.relative_to(self.target_path)
                    is_root_level = len(relative_root.parts) == 0

                    # 1. Pangkas folder terlarang dari antrean os.walk
                    dirs[:] = [d for d in dirs if not self.should_ignore(root_path / d, is_dir=True)]

                    # 2. OPTIMASI I/O TINGKAT ROOT: Hanya telusuri folder yang masuk dalam whitelist ALLOWED_DIRS
                    if is_root_level:
                        dirs[:] = [d for d in dirs if d in self.config.ALLOWED_DIRS or any(
                            d.startswith(prefix) for prefix in self.config.ALLOWED_DIRS
                        )]

                    for file_name in files:
                        file_path = root_path / file_name
                        relative_file_path = file_path.relative_to(self.target_path)
                        is_root_file = len(relative_file_path.parts) == 1

                        # Penapisan A: Sensor Berkas Sensitif, Blacklist & Gitignore
                        if self.should_ignore(file_path, is_dir=False):
                            continue

                        # Penapisan B: Saring Berkas non-esensial di tingkat Root
                        if is_root_file and file_name not in self.config.ESSENTIAL_ROOT_FILES:
                            continue

                        # Penapisan C: Saring Ekstensi yang diizinkan (Kecuali berkas konfigurasi penting root)
                        if not is_root_file and file_path.suffix not in self.config.INCLUDE_EXTENSIONS:
                            continue

                        # Penapisan D: Cheap Binary Guard
                        if self.optimizer.is_binary(file_path):
                            continue

                        # Penapisan E: Size Guard
                        try:
                            file_size = file_path.stat().st_size
                            if file_size > self.config.MAX_FILE_SIZE_BYTES:
                                print(f"[SKIP] Berkas terlalu besar ({file_size / 1024:.1f} KB): {relative_file_path}")
                                continue

                            content = file_path.read_text("utf-8", errors="ignore")
                            compressed_content = self.optimizer.compress_code(
                                content, 
                                suffix=file_path.suffix, 
                                strip_comments=self.strip_comments
                            )

                            # Tulis langsung ke stream buffer tanpa menahan seluruh isi memori di RAM
                            out_file.write(f"\n--- FILE: {relative_file_path} ---\n")
                            out_file.write(compressed_content)
                            out_file.write("\n")

                            file_count += 1
                            comp_size = len(compressed_content.encode('utf-8'))
                            original_total_size += file_size
                            compressed_total_size += comp_size
                            
                            processed_files_stats.append((str(relative_file_path), comp_size))
                            print(f"-> Menyalin & mengompresi: {relative_file_path}")

                        except Exception as e:
                            print(f"-> Gagal memproses {relative_file_path}: {e}")

            print(f"\n✅ Selesai! {file_count} Berkas berhasil disatukan di:\n   {self.output_file}")
            print(f"📊 Ukuran Asli: {original_total_size / 1024:.2f} KB")
            print(f"🚀 Ukuran Kompresi (LLM Ready): {compressed_total_size / 1024:.2f} KB")
            
            if original_total_size > 0:
                saving_percent = ((original_total_size - compressed_total_size) / original_total_size) * 100
                print(f"📉 Penghematan Ruang Konteks: ~{saving_percent:.1f}%")
                
            if processed_files_stats:
                print("\n📦 Berkas yang Disalin:")
                sorted_files = sorted(processed_files_stats, key=lambda x: x[1], reverse=True)
                for idx, (f_path, f_size) in enumerate(sorted_files, 1):
                    print(f"   {idx}. {f_path} ({f_size / 1024:.2f} KB)")

        except Exception as e:
            print(f"Critical Error: Gagal menulis file output: {e}")


# =========================================================================
# MAIN EXECUTION ENTRY POINT
# =========================================================================
if __name__ == "__main__":
    config_default = AggregatorConfig()

    parser = argparse.ArgumentParser(description="Optimasi Bundel Kode Backend NestJS / TypeScript / Prisma")
    parser.add_argument("--dir", type=str, default=config_default.DEFAULT_TARGET, help="Direktori target yang akan dipindai")
    parser.add_argument("--out", type=str, default=config_default.DEFAULT_OUTPUT, help="Nama berkas keluaran (.txt)")
    parser.add_argument("--keep-comments", action="store_true", help="Pertahankan komentar di dalam kode")
    parser.add_argument("--exclude-tests", action="store_true", help="Jangan sertakan berkas pengujian (*.test.*, *.spec.*)")
    
    args = parser.parse_args()

    aggregator = CodebaseAggregator(
        target_dir=args.dir, 
        output_name=args.out,
        strip_comments=not args.keep_comments,
        exclude_tests=args.exclude_tests
    )
    aggregator.execute()