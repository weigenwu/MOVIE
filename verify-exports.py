"""Independent native-FFmpeg check of real browser exports (local fixtures only)."""
from pathlib import Path
import hashlib, json, re, subprocess, sys
sys.path.insert(0, str(Path('test-results/native-tools').resolve()))
import imageio_ffmpeg
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
root = Path(sys.argv[1] if len(sys.argv) > 1 else '..').resolve()
reports = []
for name in ['MP4-crop.mp4', 'avi-crop.mp4', 'AVI-lossless.avi']:
    output = Path('test-results') / name
    result = subprocess.run([ffmpeg, '-hide_banner', '-i', str(output), '-f', 'null', '-'], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert '320x240' in result.stderr, result.stderr
    match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', result.stderr)
    duration = sum(float(n) * m for n, m in zip(match.groups(), (3600, 60, 1)))
    tolerance = 0.34 if name != 'MP4-crop.mp4' else 0.11
    assert abs(duration - 2) <= tolerance, duration
    reports.append({'output': name, 'size': output.stat().st_size, 'duration': duration, 'decodes': True})

def pixels(file, start, filters=None):
    command = [ffmpeg, '-v', 'error', '-ss', str(start), '-i', str(file), '-frames:v', '1']
    if filters: command += ['-vf', filters]
    return subprocess.check_output(command + ['-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])

source = sorted((root / 'avi').glob('*.avi'))[0]
reference = pixels(source, 1, 'crop=320:240:100:80:exact=1')
exported = pixels('test-results/AVI-lossless.avi', 0)
assert reference == exported, 'The lossless crop pixels do not match the original source at the requested time and coordinates.'
reports.append({'lossless_crop_pixels_equal': True, 'source_time': 1, 'crop': [100,80,320,240], 'sha256': hashlib.sha256(exported).hexdigest()})
Path('test-results/native-report.json').write_text(json.dumps(reports, indent=2), encoding='utf8')
print(json.dumps(reports, indent=2))
