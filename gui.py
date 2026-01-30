import sys
import pandas as pd
from datetime import datetime, timedelta
import os
import io # New: For handling image buffers

# --- Matplotlib for Graphs ---
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

# --- Qt Imports ---
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                               QHBoxLayout, QTabWidget, QPushButton, QLabel, 
                               QFileDialog, QTableView, QComboBox, QHeaderView, 
                               QMessageBox, QGroupBox, QLineEdit, QDateEdit, 
                               QTimeEdit, QTableWidget, QTableWidgetItem, QTextEdit, 
                               QProgressBar, QSplitter)
from PySide6.QtCore import Qt, QAbstractTableModel, QThread, Signal, QDate, QTime
from PySide6.QtGui import QColor

# --- PDF Generation Imports ---
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Image as RLImage
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

# =============================================================================
# HELPER: LOGIC ENGINE (Centralized Rules)
# =============================================================================
def check_attendance_status(cin, cout, shift_in, shift_out):
    status_flags = []
    
    # Grayscale/Report Colors
    col_minor = colors.Color(0.92, 0.92, 0.92) 
    col_major = colors.Color(0.75, 0.75, 0.75) 

    if not cin and not cout:
        return ["Absent"], col_major

    if not cin and cout:
        return ["Suspicious (No In)"], col_major

    if cin and cin > shift_in:
        status_flags.append("Late")

    if cout:
        if cout < shift_out: 
            status_flags.append("Early")
    elif cin and not cout:
        status_flags.append("No Out")

    bg_color = colors.white
    if "Absent" in status_flags or "Suspicious (No In)" in status_flags:
        bg_color = col_major
    elif "Late" in status_flags or "Early" in status_flags or "No Out" in status_flags:
        bg_color = col_minor
    
    if not status_flags:
        status_flags.append("Present")
        
    return status_flags, bg_color

# =============================================================================
# HELPER: PANDAS MODEL FOR QT TABLE VIEW
# =============================================================================
class PandasModel(QAbstractTableModel):
    def __init__(self, data):
        super(PandasModel, self).__init__()
        self._data = data

    def rowCount(self, parent=None):
        return self._data.shape[0]

    def columnCount(self, parent=None):
        return self._data.shape[1]

    def data(self, index, role=Qt.DisplayRole):
        if index.isValid():
            if role == Qt.DisplayRole:
                val = self._data.iloc[index.row(), index.column()]
                return str(val)
        return None

    def headerData(self, col, orientation, role):
        if orientation == Qt.Horizontal and role == Qt.DisplayRole:
            return str(self._data.columns[col])
        return None

# =============================================================================
# WORKER THREAD FOR PROCESSING
# =============================================================================
class AnalysisWorker(QThread):
    log_signal = Signal(str)
    progress_signal = Signal(int)
    finished_signal = Signal(object, object, object) 

    def __init__(self, raw_df, shifts, holidays, col_map):
        super().__init__()
        self.raw_df = raw_df
        self.shifts = shifts
        self.holidays = holidays
        self.col_map = col_map

    def parse_time(self, value):
        if pd.isna(value) or value == "" or str(value).strip().lower() in ['nan', 'nat', 'none']:
            return None
        if isinstance(value, (float, int)):
            try:
                return (datetime(1899, 12, 30) + timedelta(days=float(value))).time()
            except:
                pass
        value = str(value).strip()
        fmts = ["%I:%M:%S %p", "%I:%M %p", "%H:%M:%S", "%H:%M", "%Y-%m-%d %H:%M:%S"]
        for fmt in fmts:
            try:
                return datetime.strptime(value, fmt).time()
            except ValueError:
                continue
        return None

    def run(self):
        try:
            self.log_signal.emit("🔄 Initializing Data Processing...")
            df = self.raw_df.copy()
            
            c_name = self.col_map['name']
            c_date = self.col_map['date']
            c_in = self.col_map['in']
            c_out = self.col_map['out']

            # 1. Parse Dates
            self.log_signal.emit("📅 Parsing Date Column...")
            df[c_date] = pd.to_datetime(df[c_date], errors='coerce', dayfirst=True)
            df = df.dropna(subset=[c_date])

            # 2. Filter Global Range
            min_date = min(s['start'] for s in self.shifts)
            max_date = max(s['end'] for s in self.shifts)
            df = df[(df[c_date] >= min_date) & (df[c_date] <= max_date)]

            unique_names = df[c_name].unique()
            total_ppl = len(unique_names)
            self.log_signal.emit(f"👤 Found {total_ppl} unique employees.")

            summary_rows = []
            
            # 3. Main Loop
            for i, name in enumerate(unique_names):
                person_df = df[df[c_name] == name]
                stats = {"Present": 0, "Lates": 0, "Early": 0, "Absents": 0, "Suspicious": 0, "No Out": 0}

                for date in pd.date_range(start=min_date, end=max_date):
                    if date.weekday() == 6 or date in self.holidays:
                        continue

                    shift = next((s for s in self.shifts if s['start'] <= date <= s['end']), None)
                    if not shift: continue 

                    record = person_df[person_df[c_date] == date]
                    cin, cout = None, None

                    if not record.empty:
                        cin = self.parse_time(record[c_in].values[0])
                        cout = self.parse_time(record[c_out].values[0])

                    # Get Rule-Based Status
                    req_out = shift['friout'] if date.weekday() == 4 else shift['cout']
                    flags, _ = check_attendance_status(cin, cout, shift['cin'], req_out)

                    # Update Stats
                    if "Absent" in flags: stats["Absents"] += 1
                    if "Suspicious (No In)" in flags: stats["Suspicious"] += 1
                    if "Late" in flags: stats["Lates"] += 1
                    if "Early" in flags: stats["Early"] += 1
                    if "No Out" in flags: stats["No Out"] += 1
                    if "Present" in flags or "Late" in flags or "Early" in flags:
                        stats["Present"] += 1

                summary_rows.append({"Name": name, **stats})
                self.progress_signal.emit(int(((i + 1) / total_ppl) * 100))

            summary_df = pd.DataFrame(summary_rows)
            
            context = {
                "clean_df": df,
                "min_date": min_date,
                "max_date": max_date,
                "col_map": self.col_map,
                "shifts": self.shifts,
                "holidays": self.holidays
            }
            
            self.finished_signal.emit(summary_df, context, None)

        except Exception as e:
            import traceback
            self.finished_signal.emit(None, None, f"{str(e)}\n{traceback.format_exc()}")

# =============================================================================
# MAIN WINDOW CLASS
# =============================================================================
class AttendanceApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Attendance Analytics Pro (Report Edition)")
        self.resize(1200, 850)
        self.raw_df = None
        self.summary_df = None
        self.context_data = None
        self.shifts = []
        self.init_ui()

    def init_ui(self):
        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        layout = QVBoxLayout(main_widget)
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)
        self.tab_import = QWidget()
        self.tab_rules = QWidget()
        self.tab_process = QWidget()
        self.tabs.addTab(self.tab_import, "1. Data Import")
        self.tabs.addTab(self.tab_rules, "2. Shift Rules")
        self.tabs.addTab(self.tab_process, "3. Process & Export")
        self.setup_import_tab()
        self.setup_rules_tab()
        self.setup_process_tab()

    # --- TAB 1: IMPORT ---
    def setup_import_tab(self):
        layout = QVBoxLayout(self.tab_import)
        top_bar = QHBoxLayout()
        btn_load = QPushButton("📂 Load Excel/CSV File")
        btn_load.setMinimumHeight(40)
        btn_load.clicked.connect(self.load_file)
        self.lbl_file = QLabel("No file loaded")
        self.lbl_file.setStyleSheet("color: gray; font-style: italic;")
        top_bar.addWidget(btn_load)
        top_bar.addWidget(self.lbl_file)
        top_bar.addStretch()
        layout.addLayout(top_bar)
        splitter = QSplitter(Qt.Horizontal)
        layout.addWidget(splitter)
        map_group = QGroupBox("Column Mapping")
        map_layout = QVBoxLayout()
        self.combo_name = QComboBox()
        self.combo_date = QComboBox()
        self.combo_in = QComboBox()
        self.combo_out = QComboBox()
        form_layout = QVBoxLayout()
        form_layout.addWidget(QLabel("Name Column:"))
        form_layout.addWidget(self.combo_name)
        form_layout.addWidget(QLabel("Date Column:"))
        form_layout.addWidget(self.combo_date)
        form_layout.addWidget(QLabel("Clock In:"))
        form_layout.addWidget(self.combo_in)
        form_layout.addWidget(QLabel("Clock Out:"))
        form_layout.addWidget(self.combo_out)
        map_layout.addLayout(form_layout)
        map_layout.addStretch()
        map_group.setLayout(map_layout)
        preview_group = QGroupBox("Data Preview")
        prev_layout = QVBoxLayout()
        self.table_view = QTableView()
        self.table_view.setAlternatingRowColors(True)
        prev_layout.addWidget(self.table_view)
        preview_group.setLayout(prev_layout)
        splitter.addWidget(map_group)
        splitter.addWidget(preview_group)
        splitter.setSizes([300, 900])

    def load_file(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open File", "", "Excel Files (*.xlsx *.xls);;CSV Files (*.csv)")
        if not path: return
        try:
            if path.endswith('.csv'): self.raw_df = pd.read_csv(path)
            elif path.endswith('.xls'): self.raw_df = pd.read_excel(path, engine='xlrd')
            else: self.raw_df = pd.read_excel(path, engine='openpyxl')
            self.lbl_file.setText(os.path.basename(path))
            self.lbl_file.setStyleSheet("color: green; font-weight: bold;")
            model = PandasModel(self.raw_df.head(100))
            self.table_view.setModel(model)
            self.table_view.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
            cols = list(self.raw_df.columns)
            for box in [self.combo_name, self.combo_date, self.combo_in, self.combo_out]:
                box.clear()
                box.addItems(cols)
            self.auto_map_columns(cols)
        except Exception as e: QMessageBox.critical(self, "Load Error", str(e))

    def auto_map_columns(self, cols):
        cols_lower = [c.lower() for c in cols]
        def set_idx(combo, keywords):
            for k in keywords:
                for i, col in enumerate(cols_lower):
                    if k in col:
                        combo.setCurrentIndex(i)
                        return
        set_idx(self.combo_name, ['name', 'employee', 'user'])
        set_idx(self.combo_date, ['date', 'time', 'day'])
        set_idx(self.combo_in, ['in', 'start', 'login'])
        set_idx(self.combo_out, ['out', 'end', 'logout'])

    # --- TAB 2: RULES ---
    def setup_rules_tab(self):
        layout = QVBoxLayout(self.tab_rules)
        hol_group = QGroupBox("Gazetted Holidays")
        hol_layout = QHBoxLayout()
        hol_layout.addWidget(QLabel("Dates (YYYY-MM-DD, comma separated):"))
        self.txt_holidays = QLineEdit()
        self.txt_holidays.setPlaceholderText("2023-12-25, 2024-01-01")
        hol_layout.addWidget(self.txt_holidays)
        hol_group.setLayout(hol_layout)
        layout.addWidget(hol_group)
        shift_group = QGroupBox("Shift Periods Configuration")
        shift_layout = QVBoxLayout()
        input_row = QHBoxLayout()
        self.date_start = QDateEdit(QDate.currentDate())
        self.date_start.setCalendarPopup(True)
        self.date_start.setDisplayFormat("yyyy-MM-dd")
        self.date_end = QDateEdit(QDate.currentDate().addDays(30))
        self.date_end.setCalendarPopup(True)
        self.date_end.setDisplayFormat("yyyy-MM-dd")
        self.time_in = QTimeEdit(QTime(9, 0))
        self.time_out = QTimeEdit(QTime(17, 0))
        self.time_fri = QTimeEdit(QTime(13, 0))
        
        def add_field(lbl, widget):
            v = QVBoxLayout()
            v.addWidget(QLabel(lbl))
            v.addWidget(widget)
            input_row.addLayout(v)
        
        add_field("Start Date", self.date_start)
        add_field("End Date", self.date_end)
        add_field("Check In", self.time_in)
        add_field("Check Out", self.time_out)
        add_field("Fri Out", self.time_fri)
        
        btn_add = QPushButton("➕ Add Shift")
        btn_add.clicked.connect(self.add_shift)
        btn_add.setStyleSheet("background-color: #4CAF50; color: white; font-weight: bold;")
        input_row.addWidget(btn_add)
        shift_layout.addLayout(input_row)
        self.shift_table = QTableWidget(0, 5)
        self.shift_table.setHorizontalHeaderLabels(["Start", "End", "In", "Out", "Fri Out"])
        self.shift_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        shift_layout.addWidget(self.shift_table)
        btn_del = QPushButton("🗑️ Remove Selected Shift")
        btn_del.clicked.connect(self.remove_shift)
        shift_layout.addWidget(btn_del)
        shift_group.setLayout(shift_layout)
        layout.addWidget(shift_group)

    def add_shift(self):
        s_date = self.date_start.date().toPython()
        e_date = self.date_end.date().toPython()
        ts_start = pd.to_datetime(s_date)
        ts_end = pd.to_datetime(e_date)
        if ts_start > ts_end:
            QMessageBox.warning(self, "Error", "Start date must be before End date.")
            return
        new_shift = {
            "start": ts_start,
            "end": ts_end,
            "cin": self.time_in.time().toPython(),
            "cout": self.time_out.time().toPython(),
            "friout": self.time_fri.time().toPython()
        }
        self.shifts.append(new_shift)
        row = self.shift_table.rowCount()
        self.shift_table.insertRow(row)
        self.shift_table.setItem(row, 0, QTableWidgetItem(str(s_date)))
        self.shift_table.setItem(row, 1, QTableWidgetItem(str(e_date)))
        self.shift_table.setItem(row, 2, QTableWidgetItem(self.time_in.text()))
        self.shift_table.setItem(row, 3, QTableWidgetItem(self.time_out.text()))
        self.shift_table.setItem(row, 4, QTableWidgetItem(self.time_fri.text()))

    def remove_shift(self):
        row = self.shift_table.currentRow()
        if row >= 0:
            self.shifts.pop(row)
            self.shift_table.removeRow(row)

    # --- TAB 3: PROCESS ---
    def setup_process_tab(self):
        layout = QVBoxLayout(self.tab_process)
        ctrl_layout = QHBoxLayout()
        self.btn_run = QPushButton("⚙️ Run Analysis")
        self.btn_run.setMinimumHeight(50)
        self.btn_run.setStyleSheet("font-size: 14px; font-weight: bold;")
        self.btn_run.clicked.connect(self.start_processing)
        
        self.btn_pdf = QPushButton("📄 Individual Reports (PDF)")
        self.btn_pdf.setEnabled(False)
        self.btn_pdf.clicked.connect(self.export_pdf)

        self.btn_overall = QPushButton("📊 Executive Summary Report (PDF)")
        self.btn_overall.setEnabled(False)
        self.btn_overall.setStyleSheet("background-color: #0078D7; color: white;")
        self.btn_overall.clicked.connect(self.export_overall_pdf)
        
        ctrl_layout.addWidget(self.btn_run)
        ctrl_layout.addWidget(self.btn_pdf)
        ctrl_layout.addWidget(self.btn_overall)
        layout.addLayout(ctrl_layout)
        
        self.pbar = QProgressBar()
        layout.addWidget(self.pbar)
        layout.addWidget(QLabel("Processing Log:"))
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        self.log_console.setStyleSheet("background-color: #f0f0f0; font-family: Monospace;")
        layout.addWidget(self.log_console)

    def log(self, msg):
        self.log_console.append(msg)
        sb = self.log_console.verticalScrollBar()
        sb.setValue(sb.maximum())

    def start_processing(self):
        if self.raw_df is None:
            QMessageBox.warning(self, "Missing Data", "Please load a file first.")
            self.tabs.setCurrentIndex(0)
            return
        if not self.shifts:
            QMessageBox.warning(self, "Missing Rules", "Please add Shift Periods.")
            self.tabs.setCurrentIndex(1)
            return

        col_map = {"name": self.combo_name.currentText(), "date": self.combo_date.currentText(),
                   "in": self.combo_in.currentText(), "out": self.combo_out.currentText()}
        hol_str = self.txt_holidays.text()
        holidays = set()
        if hol_str:
            try: holidays = {pd.to_datetime(d.strip()) for d in hol_str.split(',') if d.strip()}
            except: self.log("⚠️ Warning: Could not parse holidays.")

        self.btn_run.setEnabled(False)
        self.log_console.clear()
        self.pbar.setValue(0)
        self.worker = AnalysisWorker(self.raw_df, self.shifts, holidays, col_map)
        self.worker.log_signal.connect(self.log)
        self.worker.progress_signal.connect(self.pbar.setValue)
        self.worker.finished_signal.connect(self.on_process_finished)
        self.worker.start()

    def on_process_finished(self, summary_df, context, error):
        self.btn_run.setEnabled(True)
        if error:
            QMessageBox.critical(self, "Processing Error", error)
            return
        self.summary_df = summary_df
        self.context_data = context
        self.log("\n✅ Analysis Complete!")
        self.log(str(summary_df.head()))
        self.btn_pdf.setEnabled(True)
        self.btn_overall.setEnabled(True)
        QMessageBox.information(self, "Success", "Analysis complete.")

    # --- EXPORT: INDIVIDUAL REPORTS ---
    def export_pdf(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save Individual Report", "attendance_detailed.pdf", "PDF Files (*.pdf)")
        if not path: return
        try:
            self.log("Generating Detailed PDF...")
            doc = SimpleDocTemplate(path, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=30, bottomMargin=30)
            elements = []
            styles = getSampleStyleSheet()
            
            title_style = ParagraphStyle('MainTitle', parent=styles['Heading1'], alignment=1, fontSize=16, spaceAfter=10)
            
            df = self.context_data['clean_df']
            col_map = self.context_data['col_map']
            min_d = self.context_data['min_date']
            max_d = self.context_data['max_date']
            shifts = self.context_data['shifts']
            holidays = self.context_data['holidays']
            names = df[col_map['name']].unique()
            
            for name in names:
                person_df = df[df[col_map['name']] == name]
                table_data = [["Date", "In Time", "Out Time", "Status"]]
                row_colors = [] 
                
                cnt_late = 0
                cnt_early = 0
                cnt_absent = 0
                cnt_suspicious = 0
                
                row_idx = 1

                for date in pd.date_range(start=min_d, end=max_d):
                    if date.weekday() == 6 or date in holidays: continue
                    shift = next((s for s in shifts if s['start'] <= date <= s['end']), None)
                    if not shift: continue

                    record = person_df[person_df[col_map['date']] == date]
                    cin, cout = None, None
                    if not record.empty:
                        cin = self.worker.parse_time(record[col_map['in']].values[0])
                        cout = self.worker.parse_time(record[col_map['out']].values[0])

                    req_out = shift['friout'] if date.weekday() == 4 else shift['cout']
                    flags, bg_col = check_attendance_status(cin, cout, shift['cin'], req_out)

                    if "Late" in flags: cnt_late += 1
                    if "Early" in flags: cnt_early += 1
                    if "Absent" in flags: cnt_absent += 1
                    if "Suspicious (No In)" in flags: cnt_suspicious += 1

                    table_data.append([
                        date.strftime("%d-%b (%a)"),
                        cin.strftime("%H:%M") if cin else "-",
                        cout.strftime("%H:%M") if cout else "-",
                        ", ".join(flags)
                    ])
                    
                    if bg_col != colors.white:
                        row_colors.append((row_idx, bg_col))
                    row_idx += 1

                elements.append(Paragraph("ATTENDANCE REPORT", title_style))
                
                info_data = [
                    [f"Name: {name}", f"Date Range: {min_d.strftime('%Y-%m-%d')} to {max_d.strftime('%Y-%m-%d')}"],
                    [f"Lates: {cnt_late} | Early: {cnt_early} | Absent: {cnt_absent} | Suspicious: {cnt_suspicious}", ""]
                ]
                t_info = Table(info_data, colWidths=[300, 200])
                t_info.setStyle(TableStyle([
                    ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
                    ('FONTSIZE', (0,0), (-1,-1), 10),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                ]))
                elements.append(t_info)
                elements.append(Spacer(1, 10))

                t = Table(table_data, colWidths=[100, 80, 80, 200])
                tbl_style_cmds = [
                    ('BACKGROUND', (0,0), (-1,0), colors.black),
                    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                    ('GRID', (0,0), (-1,-1), 0.5, colors.black),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('ALIGN', (1,0), (2,-1), 'CENTER'),
                ]
                
                for r_idx, colr in row_colors:
                    tbl_style_cmds.append(('BACKGROUND', (0, r_idx), (-1, r_idx), colr))

                t.setStyle(TableStyle(tbl_style_cmds))
                elements.append(t)
                elements.append(Spacer(1, 20))

                payroll_data = [
                    ["PAYROLL CALCULATION & ACKNOWLEDGMENT", "", ""],
                    ["Total Amount: _____________", "Per Day Ded.: _____________", "Ded. Days: _____________"],
                    ["Ded. Amount: _____________", "Payable Amt: _____________", ""],
                    ["", "", ""], 
                    ["Receiving Date: _____________", "Signature: __________________________", ""]
                ]
                
                t_pay = Table(payroll_data, colWidths=[170, 170, 170])
                t_pay.setStyle(TableStyle([
                    ('SPAN', (0,0), (-1,0)), 
                    ('ALIGN', (0,0), (-1,0), 'LEFT'),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0,0), (-1,0), 10),
                    ('BOTTOMPADDING', (0,0), (-1,0), 10),
                    ('BOTTOMPADDING', (0,1), (-1,2), 15), 
                    ('BOTTOMPADDING', (0,4), (-1,4), 5),
                    ('BOX', (0,0), (-1,-1), 1, colors.black),
                    ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
                ]))
                
                elements.append(KeepTogether(t_pay))
                elements.append(PageBreak())

            doc.build(elements)
            self.log(f"✅ Detailed PDF Saved: {path}")
            QMessageBox.information(self, "Success", "Detailed Report Generated!")
        except Exception as e:
            self.log(str(e))
            QMessageBox.critical(self, "Error", str(e))

    # --- NEW: EXECUTIVE SUMMARY WITH GRAPHS ---
    def export_overall_pdf(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save Executive Report", "attendance_executive_summary.pdf", "PDF Files (*.pdf)")
        if not path: return
        try:
            self.log("Generating Executive Report with Graphs...")
            
            # 1. Setup Data for Visuals
            total_present = self.summary_df['Present'].sum()
            total_absent = self.summary_df['Absents'].sum()
            total_late = self.summary_df['Lates'].sum()
            total_early = self.summary_df['Early'].sum()
            
            top_lates = self.summary_df.nlargest(5, 'Lates')
            top_absents = self.summary_df.nlargest(5, 'Absents')

            # 2. Setup Document
            doc = SimpleDocTemplate(path, pagesize=A4, rightMargin=30, leftMargin=30, topMargin=40, bottomMargin=40)
            elements = []
            styles = getSampleStyleSheet()
            
            # --- PAGE 1: VISUAL ANALYTICS ---
            elements.append(Paragraph("Executive Attendance Summary", styles['Title']))
            elements.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d')}", styles['Normal']))
            elements.append(Spacer(1, 20))

            # Helper to Convert Matplotlib Plot to ReportLab Image
            def fig_to_image(fig):
                buf = io.BytesIO()
                fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
                buf.seek(0)
                plt.close(fig) # Close to free memory
                return RLImage(buf, width=450, height=250)

            # GRAPH 1: Pie Chart (Overall Distribution)
            fig1, ax1 = plt.subplots(figsize=(6, 3.5))
            labels = ['Present', 'Absent', 'Late', 'Early']
            sizes = [total_present, total_absent, total_late, total_early]
            colors_list = ['#4CAF50', '#F44336', '#FF9800', '#2196F3'] # Green, Red, Orange, Blue
            wedges, texts, autotexts = ax1.pie(sizes, labels=labels, autopct='%1.1f%%', colors=colors_list, startangle=90)
            ax1.axis('equal')
            plt.title("Overall Attendance Distribution")
            plt.setp(autotexts, size=8, weight="bold", color="white")
            
            elements.append(fig_to_image(fig1))
            elements.append(Spacer(1, 20))

            # GRAPH 2: Top 5 Late Comers (Bar Chart)
            if not top_lates.empty and top_lates['Lates'].sum() > 0:
                fig2, ax2 = plt.subplots(figsize=(7, 3.5))
                ax2.bar(top_lates['Name'], top_lates['Lates'], color='#FF9800')
                ax2.set_title("Top 5 Employees: Late Arrivals")
                ax2.set_ylabel("Count")
                plt.xticks(rotation=15, ha='right', fontsize=8)
                plt.grid(axis='y', linestyle='--', alpha=0.7)
                elements.append(fig_to_image(fig2))
                elements.append(Spacer(1, 10))

            # GRAPH 3: Top 5 Absentees (Bar Chart)
            if not top_absents.empty and top_absents['Absents'].sum() > 0:
                fig3, ax3 = plt.subplots(figsize=(7, 3.5))
                ax3.bar(top_absents['Name'], top_absents['Absents'], color='#F44336')
                ax3.set_title("Top 5 Employees: Absences")
                ax3.set_ylabel("Count")
                plt.xticks(rotation=15, ha='right', fontsize=8)
                plt.grid(axis='y', linestyle='--', alpha=0.7)
                elements.append(fig_to_image(fig3))
            
            elements.append(PageBreak())

            # --- PAGE 2+: HEATMAP DATA TABLE ---
            elements.append(Paragraph("Detailed Employee Statistics (Heatmap)", styles['Heading2']))
            elements.append(Spacer(1, 10))

            headers = ["Name", "Present", "Late", "Early", "Absent", "Suspic."]
            data = [headers]
            
            for _, row in self.summary_df.iterrows():
                data.append([
                    str(row['Name']),
                    str(row['Present']),
                    str(row['Lates']),
                    str(row['Early']),
                    str(row['Absents']),
                    str(row['Suspicious'])
                ])

            t = Table(data, colWidths=[150, 60, 60, 60, 60, 60])
            
            # Base Style
            style_cmds = [
                ('BACKGROUND', (0,0), (-1,0), colors.darkslategrey),
                ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                ('GRID', (0,0), (-1,-1), 1, colors.black),
                ('FONTSIZE', (0,0), (-1,-1), 10),
                ('ALIGN', (1,0), (-1,-1), 'CENTER'),
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ]

            # Heatmap Logic (Conditional Formatting)
            # Define severity colors
            c_safe = colors.white
            c_warn = colors.Color(1, 0.9, 0.7) # Light Orange
            c_bad  = colors.Color(1, 0.6, 0.6) # Light Red
            c_crit = colors.Color(0.8, 0.2, 0.2) # Dark Red (Text White)

            for i, row in enumerate(data[1:], start=1):
                # Late Column (Index 2)
                lates = int(row[2])
                if lates >= 5: 
                    style_cmds.append(('BACKGROUND', (2, i), (2, i), c_bad))
                elif lates >= 3:
                    style_cmds.append(('BACKGROUND', (2, i), (2, i), c_warn))
                
                # Absent Column (Index 4)
                absents = int(row[4])
                if absents >= 3:
                    style_cmds.append(('BACKGROUND', (4, i), (4, i), c_bad))
                elif absents >= 1:
                    style_cmds.append(('BACKGROUND', (4, i), (4, i), c_warn))
                
                # Suspicious Column (Index 5)
                susp = int(row[5])
                if susp > 0:
                    style_cmds.append(('BACKGROUND', (5, i), (5, i), colors.lightgrey))

            t.setStyle(TableStyle(style_cmds))
            elements.append(t)
            
            doc.build(elements)
            self.log(f"✅ Executive Report Saved: {path}")
            QMessageBox.information(self, "Success", "Executive Report with Graphs Generated!")

        except Exception as e:
            self.log(str(e))
            QMessageBox.critical(self, "Error", str(e))

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion") 
    window = AttendanceApp()
    window.show()
    sys.exit(app.exec())
