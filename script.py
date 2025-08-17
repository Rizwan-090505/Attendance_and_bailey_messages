import pandas as pd
from datetime import datetime, timedelta

# --- Robust Time Parser ---
def parse_time(value):
    """
    Parses time from various formats including:
    - 12-hour (e.g., 07:30 AM)
    - 24-hour (e.g., 13:15)
    - Excel float (e.g., 0.30138)
    Returns None if parsing fails.
    """
    if pd.isna(value):
        return None
    if isinstance(value, float):  # Excel float time
        try:
            return (datetime(1899, 12, 30) + timedelta(days=value)).time()
        except:
            return None
    value = str(value).strip()
    time_formats = [
        "%I:%M:%S %p", "%I:%M %p",  # 12-hour
        "%H:%M:%S", "%H:%M"         # 24-hour
    ]
    for fmt in time_formats:
        try:
            return datetime.strptime(value, fmt).time()
        except:
            continue
    return None

# --- Load Excel File ---
xls_path = "Teacher attendace list.xls"
try:
    print("📂 Reading Excel file...")
    df = pd.read_excel(xls_path, engine="xlrd")
except Exception as e:
    print("❌ Could not read file:", e)
    exit()

# --- Debug Raw Read ---
print("\n📋 Data Preview (First 10 Rows):")
print(df.head(10))
print("🧠 Column Types:\n", df.dtypes)
print("🗂️ Columns Detected:", df.columns.tolist())

# --- Parse Dates ---
try:
    print("\n🕐 Parsing 'Date' column...")
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
except Exception as e:
    print("❌ Date parsing failed:", e)
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')

df = df.dropna(subset=['Date'])  # Remove unparsed dates
print("✅ Dates parsed. Sample:", df['Date'].dropna().unique()[:5])

# --- Date Range Input ---
from_date = input("\nEnter start date (YYYY-MM-DD): ").strip()
to_date = input("Enter end date (YYYY-MM-DD): ").strip()
start_date = pd.to_datetime(from_date)
end_date = pd.to_datetime(to_date)
print(f"📆 Selected Range: {start_date.date()} to {end_date.date()}")

# --- Gazetted Holidays ---
gazetted_input = input("Enter gazetted holidays (comma-separated YYYY-MM-DD, or leave blank): ").strip()
gazetted_holidays = set(pd.to_datetime(gazetted_input.split(','))) if gazetted_input else set()
print(f"🏛️ Gazetted Holidays: {[d.date() for d in gazetted_holidays]}")

# --- Multi-Time Configuration ---
periods = []
num_periods = int(input("\nHow many different time periods? (e.g. 2): ").strip())

for i in range(num_periods):
    print(f"\n📅 Period {i+1}")
    p_start = pd.to_datetime(input("  ➤ Start date (YYYY-MM-DD): ").strip())
    p_end = pd.to_datetime(input("  ➤ End date (YYYY-MM-DD): ").strip())
    p_cin = datetime.strptime(input("  ⏰ Check-in time (e.g. 08:00): "), "%H:%M").time()
    p_cout = datetime.strptime(input("  ⏰ Check-out time (e.g. 16:00): "), "%H:%M").time()
    p_friout = datetime.strptime(input("  🕌 Friday check-out (e.g. 12:30): "), "%H:%M").time()
    periods.append({
        "start": p_start,
        "end": p_end,
        "cin": p_cin,
        "cout": p_cout,
        "friout": p_friout
    })

print("\n🧭 Timetable periods recorded:", len(periods))

# --- Filter Date Range ---
df = df[(df['Date'] >= start_date) & (df['Date'] <= end_date)]
print(f"\n🔍 Filtered rows in range: {len(df)}")
if df.empty:
    print("⚠️ No data found in given date range. Check your date format or source.")
    exit()

# --- Detect Clock Columns ---
in_col = next((col for col in df.columns if 'clock' in col.lower() and 'in' in col.lower()), None)
out_col = next((col for col in df.columns if 'clock' in col.lower() and 'out' in col.lower()), None)

print(f"✅ Detected Clock In column: '{in_col}'")
print(f"✅ Detected Clock Out column: '{out_col}'")

if not in_col or not out_col:
    print("❌ Could not detect clock columns. Please check your Excel column headers.")
    exit()

summary_rows = []

# --- Process Each Employee ---
print("\n📊 Starting Attendance Analysis...\n" + "-"*60)
for name in df['Name'].unique():
    print(f"\n👤 Processing: {name}")
    person_df = df[df['Name'] == name]
    late_count = 0
    early_count = 0
    absent_count = 0
    suspicious_count = 0
    present_count = 0

    for date in pd.date_range(start=start_date, end=end_date):
        if date.weekday() == 6 or date in gazetted_holidays:
            continue  # Sunday or gazetted holiday

        # --- Get correct timing for this date ---
        check_in_time = check_out_time = friday_out_time = None
        for p in periods:
            if p['start'] <= date <= p['end']:
                check_in_time = p['cin']
                check_out_time = p['cout']
                friday_out_time = p['friout']
                break
        if check_in_time is None:
            print(f"⚠️ No timing found for {date.date()} — skipping.")
            continue

        record = person_df[person_df['Date'] == date]
        clock_in = None
        clock_out = None

        if not record.empty:
            in_raw = record[in_col].values[0]
            out_raw = record[out_col].values[0]
            clock_in = parse_time(in_raw)
            clock_out = parse_time(out_raw)

        # --- Decision Tree ---
        if not clock_in and not clock_out:
            absent_count += 1
            continue
        elif not clock_in and clock_out:
            suspicious_count += 1
            present_count += 1  # still counted as present
            continue

        # If we reach here, it's a proper presence
        present_count += 1

        if clock_in and clock_in > check_in_time:
            late_count += 1

        required_out = friday_out_time if date.weekday() == 4 else check_out_time
        early_margin = (datetime.combine(date, required_out) - timedelta(minutes=20)).time()

        if clock_out and clock_out < early_margin:
            early_count += 1

    summary_rows.append({
        "Name": name,
        "Lates": late_count,
        "Early Leaves": early_count,
        "Absents": absent_count,
        "Suspicious Days": suspicious_count,
        "Present Days": present_count
    })

    print(f"   🔸 Lates: {late_count}")
    print(f"   🔸 Early Leaves: {early_count}")
    print(f"   🔸 Absents: {absent_count}")
    print(f"   ⚠️  Suspicious Days (Clock-Out Only): {suspicious_count}")
    print(f"   ✅ Present Days: {present_count}")
    print("-" * 40)

# --- Export Summary ---
summary_df = pd.DataFrame(summary_rows)
summary_df.to_excel("attendance_summary_by_date.xlsx", index=False)
print("\n✅ Summary exported to 'attendance_summary_by_date.xlsx'")
