function getLocalISOStringForInput() {
    const now = new Date();
    const pad = (num) => String(num).padStart(2, '0');
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    return `${year}-${month}-${day}`;
}


document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let machines = {};
    let records = [];
    let selectedStatus = '';
    let statusPieChart = null;
    let recordsByDayChart = null;
    let machineTrendChart = null;

    // --- DOM ELEMENTS ---
    const loader = document.getElementById('loader');
    const machineSelect = document.getElementById('machine-select');
    const historyMachineSelect = document.getElementById('history-machine-select');
    const recordsGrid = document.getElementById('records-grid');
    const accessInfoBox = document.getElementById('access-info');
    const accessLocal = document.getElementById('access-local');
    const accessLan = document.getElementById('access-lan');

    // --- UTILS ---
    const showLoader = (show) => {
        loader.style.display = show ? 'flex' : 'none';
    };

    const showAlert = (message, isConfirm = false, title = 'แจ้งเตือน') => {
        return new Promise((resolve) => {
            const modal = document.getElementById('alertModal');
            document.getElementById('alert-modal-title').textContent = title;
            document.getElementById('alert-modal-body').textContent = message;
            const confirmBtn = document.getElementById('alert-modal-confirm');
            const cancelBtn = document.getElementById('alert-modal-cancel');

            confirmBtn.style.display = 'inline-block';
            cancelBtn.style.display = isConfirm ? 'inline-block' : 'none';

            modal.style.display = 'flex';

            const close = (result) => {
                modal.style.display = 'none';
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve(result);
            };

            confirmBtn.onclick = () => close(true);
            cancelBtn.onclick = () => close(false);
        });
    };

    // --- SOCKET.IO ---
    try {
        const socket = io();
        socket.on('records-updated', () => {
            loadRecords(); // Refresh on any change
        });
    } catch (e) {
        console.warn('Socket.IO connection failed.', e);
        showAlert('ไม่สามารถเชื่อมต่อ Realtime ได้, ข้อมูลอาจไม่อัปเดตทันที');
    }

    // --- API CALLS ---
    const fetchData = async (url, options = {}) => {
        showLoader(true);
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `HTTP error! status: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            console.error(`Fetch Error for ${url}:`, error);
            showAlert(`เกิดข้อผิดพลาด: ${error.message}`);
            return null; // Return null on error
        } finally {
            showLoader(false);
        }
    };

    async function initializeApp() {
        const machineData = await fetchData('/api/machines');
        if (machineData) {
            machines = machineData;
            populateMachineDropdowns();
        }
        document.getElementById('calibration-date').value = getLocalISOStringForInput();
        await loadRecords();
        refreshAccessInfo();
    }

    async function loadRecords() {
        const data = await fetchData('/api/records');
        if (data) {
            records = data.map(rec => ({
              ...rec,
              id: rec._id // Ensure backward compatibility if some parts use 'id'
            })).sort((a, b) => new Date(b.date) - new Date(a.date));

            renderFilteredRecords(); // Use filter rendering
            updateUIOnDataChange();
        }
    }

    async function refreshAccessInfo() {
        if (!accessInfoBox) return;
        try {
            const response = await fetch('/api/server-info');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const info = await response.json();
            if (info.baseUrl) {
                accessLocal.textContent = info.baseUrl;
            }
            if (Array.isArray(info.lanUrls) && info.lanUrls.length) {
                // แสดง URL สำหรับมือถือให้ชัดเจน
                const urlList = info.lanUrls.map(url => `<code>${url}</code>`).join('<br>');
                accessLan.innerHTML = `📱 สำหรับมือถือ:<br>${urlList}`;
            } else if (info.isBoundToAll) {
                accessLan.textContent = '🔄 กำลังตรวจสอบ IP Address...';
            } else if (info.configPath) {
                accessLan.innerHTML = '⚠️ แก้ host เป็น <code>0.0.0.0</code> ที่ไฟล์ config.json';
            } else {
                accessLan.innerHTML = '📱 ใช้คำสั่ง <code>npm run start:lan</code> เพื่อแชร์บนเครือข่าย';
            }
            accessInfoBox.style.display = 'inline-flex';
        } catch (err) {
            console.warn('ไม่สามารถดึงข้อมูลเซิร์ฟเวอร์ได้:', err);
        }
    }

    // --- UI RENDERING & UPDATES ---
    function populateMachineDropdowns() {
        const options = ['<option value="">-- เลือกเครื่องย้อม --</option>', ...Object.keys(machines).map(m => `<option value="${m}">${m}</option>`)];
        machineSelect.innerHTML = options.join('');
        historyMachineSelect.innerHTML = options.join('');
    }

    function renderRecords(recordsToRender) {
        if (!recordsToRender.length) {
            recordsGrid.innerHTML = '<div class="no-records">ไม่พบข้อมูลการสอบเทียบ</div>';
            return;
        }
        recordsGrid.innerHTML = recordsToRender.map(r => `
            <div class="record-card">
              <div class="record-header">
                <div style="font-weight:800;">${r.machine}</div>
                <div class="status-badge ${r.status}">${r.status === 'pass' ? 'ผ่าน' : 'ไม่ผ่าน'}</div>
              </div>
              <div style="line-height:1.6;">
                <div><strong>ปริมาตร:</strong> ${r.volume} ลิตร</div>
                <div><strong>วันที่สอบเทียบ:</strong> ${new Date(r.date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                <div><strong>ผู้สอบเทียบ:</strong> ${r.calibrator || '-'}</div>
                <div><strong>บันทึกเมื่อ:</strong> ${new Date(r.timestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
                ${r.notes ? `<div><strong>หมายเหตุ:</strong> ${r.notes}</div>` : ''}
              </div>
              ${r.image ? `<img class="image-preview" style="width:100%;height:200px;margin-top:10px;object-fit:cover;border-radius:10px;" src="${r.image}" alt="Calibration Image" data-img-src="${r.image}">` : ''}
            </div>
        `).join('');
    }

    function updateUIOnDataChange() {
        const activeTab = document.querySelector('.tab-content.active').id;
        if (activeTab === 'summary') {
            updateSummary();
            buildSummaryCharts();
        }
        if (activeTab === 'machine-history') {
            showMachineHistory();
        }
    }

    // --- TABS ---
    function switchTab(tabName) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.getElementById(tabName).classList.add('active');
      document.querySelector(`.nav-tab[data-tab="${tabName}"]`).classList.add('active');

      if (tabName === 'summary') {
          updateSummary();
          buildSummaryCharts();
      }
      if (tabName === 'machine-history') {
          historyMachineSelect.value = '';
          showMachineHistory();
      }
    }

    // --- FORM HANDLING ---
    function clearForm() {
        document.getElementById('machine-select').value = '';
        document.getElementById('calibrator-select').value = '';
        document.getElementById('calibration-date').value = getLocalISOStringForInput();
        document.getElementById('image-upload').value = '';
        document.getElementById('notes').value = '';
        selectedStatus = '';
        document.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active'));
    }

    async function addRecord() {
      const machine = document.getElementById('machine-select').value;
      const localDateValue = document.getElementById('calibration-date').value;
      const calibrator = document.getElementById('calibrator-select').value;
      const notes = document.getElementById('notes').value;
      const file = document.getElementById('image-upload').files[0];

      if (!machine || !localDateValue || !selectedStatus || !calibrator) {
        showAlert('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
      }

      const dateInUTC = new Date(localDateValue).toISOString();

      const fd = new FormData();
      fd.append('machine', machine);
      fd.append('date', dateInUTC);
      fd.append('status', selectedStatus);
      fd.append('calibrator', calibrator);
      fd.append('notes', notes);
      if (file) fd.append('image', file);

      const result = await fetchData('/api/records', { method: 'POST', body: fd });
      if(result) {
          clearForm();
          showAlert('บันทึกข้อมูลสำเร็จ!');
      }
    }

    // --- FILTERS ---
    function renderFilteredRecords() {
        const searchTerm = document.getElementById('filter-search').value.toLowerCase();
        const statusFilter = document.getElementById('filter-status').value;
        const calibratorFilter = document.getElementById('filter-calibrator').value;
        const dateFilter = document.getElementById('filter-date').value;

        const filtered = records.filter(r => {
            const dateMatch = !dateFilter || r.date.startsWith(dateFilter);
            const machineMatch = !searchTerm || r.machine.toLowerCase().includes(searchTerm);
            const statusMatch = !statusFilter || r.status === statusFilter;
            const calibratorMatch = !calibratorFilter || r.calibrator === calibratorFilter;
            return dateMatch && machineMatch && statusMatch && calibratorMatch;
        });
        renderRecords(filtered);
    }

    // --- MACHINE HISTORY ---
    function showMachineHistory() {
        const selectedMachine = historyMachineSelect.value;
        const details = document.getElementById('machine-details');
        const noSel = document.getElementById('no-machine-selected');

        if (!selectedMachine) {
            details.style.display = 'none';
            noSel.style.display = 'block';
            return;
        }
        details.style.display = 'block';
        noSel.style.display = 'none';

        const mRecs = records.filter(r => r.machine === selectedMachine);
        const sorted = [...mRecs].sort((a, b) => new Date(a.date) - new Date(b.date));
        const latest = sorted[sorted.length - 1];

        document.getElementById('selected-machine-name').textContent = selectedMachine;
        document.getElementById('selected-machine-volume').textContent = machines[selectedMachine];
        document.getElementById('selected-machine-count').textContent = mRecs.length;
        document.getElementById('selected-machine-status').innerHTML = latest
            ? (latest.status === 'pass' ? '<span class="stat-pass">✅ ผ่าน</span>' : '<span class="stat-fail">❌ ไม่ผ่าน</span>')
            : '<span class="stat-pending">⏳ ยังไม่ได้สอบเทียบ</span>';

        // Render table
        const tbody = document.getElementById('machine-history-tbody');
        if (!mRecs.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding:20px;color:#666;">ยังไม่มีประวัติการสอบเทียบสำหรับเครื่องนี้</td></tr>';
        } else {
            const desc = [...mRecs].sort((a, b) => new Date(b.date) - new Date(a.date));
            tbody.innerHTML = desc.map((r, i) => `
                <tr>
                    <td>${desc.length - i}</td>
                    <td>${new Date(r.date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</td>
                    <td>${r.status === 'pass' ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}</td>
                    <td>${r.calibrator}</td>
                    <td style="font-size:.9rem;color:#666;">${new Date(r.timestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</td>
                    <td>${r.image ? `<img class="image-preview" src="${r.image}" data-img-src="${r.image}">` : '-'}</td>
                    <td>
                        <button class="btn btn-outline" data-action="view" data-id="${r.id}">ดู</button>
                        <button class="btn btn-danger" data-action="delete" data-id="${r.id}">ลบ</button>
                    </td>
                </tr>
            `).join('');
        }
        buildMachineTrendChart(sorted);
    }

    async function deleteRecord(id) {
        const confirmed = await showAlert(`ยืนยันลบข้อมูลนี้?`, true, 'ยืนยันการลบ');
        if (!confirmed) return;

        await fetchData(`/api/records/${id}`, { method: 'DELETE' });
    }

    async function bulkDelete() {
        const machine = historyMachineSelect.value;
        if (!machine) {
            showAlert('กรุณาเลือกเครื่อง');
            return;
        }
        const confirmed = await showAlert(`ยืนยันลบข้อมูลทั้งหมดของเครื่อง ${machine}? การกระทำนี้ไม่สามารถย้อนกลับได้`, true, 'ยืนยันการลบ');
        if (!confirmed) return;

        const resp = await fetchData(`/api/records?machine=${encodeURIComponent(machine)}`, { method: 'DELETE' });
        if (resp) {
            showAlert(resp.message || 'ลบข้อมูลเรียบร้อยแล้ว');
        }
    }

    // --- SUMMARY & CHARTS ---
    function updateSummary() {
      const totalMachines = Object.keys(machines).length;
      const statusByMachine = {};
      Object.keys(machines).forEach(m => statusByMachine[m] = { machine:m, volume:machines[m], status:'pending', lastDate:'-', count:0 });

      records.forEach(r => {
        const cur = statusByMachine[r.machine];
        if (cur) {
          cur.count++;
          if (cur.lastDate === '-' || new Date(r.date) > new Date(cur.lastDate)) {
            cur.lastDate = r.date;
            cur.status = r.status;
          }
        }
      });

      let pass=0, fail=0, pending=0;
      Object.values(statusByMachine).forEach(m => {
        if (m.status === 'pass') pass++; else if (m.status === 'fail') fail++; else pending++;
      });

      document.getElementById('total-machines').textContent = totalMachines;
      document.getElementById('passed-machines').textContent = pass;
      document.getElementById('failed-machines').textContent = fail;
      document.getElementById('pending-machines').textContent = pending;

      const tbody = document.getElementById('summary-tbody');
      tbody.innerHTML = Object.values(statusByMachine).map(m => `
        <tr>
          <td style="text-align:left;font-weight:700;">${m.machine}</td>
          <td>${m.volume}</td>
          <td>${m.status==='pass'?'✅ ผ่าน': m.status==='fail'?'❌ ไม่ผ่าน':'⏳ รอสอบเทียบ'}</td>
          <td>${m.lastDate==='-'?'-': new Date(m.lastDate).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</td>
          <td>${m.count}</td>
        </tr>
      `).join('');
    }

    function buildSummaryCharts() {
        const pieCtx = document.getElementById('statusPie').getContext('2d');
        const lineCtx = document.getElementById('recordsByDay').getContext('2d');

        // Pie Chart
        const pass = +document.getElementById('passed-machines').textContent;
        const fail = +document.getElementById('failed-machines').textContent;
        const pending = +document.getElementById('pending-machines').textContent;
        if (statusPieChart) statusPieChart.destroy();
        statusPieChart = new Chart(pieCtx, {
            type: 'pie',
            data: {
                labels: ['ผ่าน', 'ไม่ผ่าน', 'รอสอบเทียบ'],
                datasets: [{
                    data: [pass, fail, pending],
                    backgroundColor: ['#28a745', '#dc3545', '#ffc107']
                }]
            },
            options: { plugins: { legend: { position: 'bottom' } } }
        });

        // Line Chart
        const byDay = records.reduce((acc, r) => {
            const key = r.date.slice(0, 10); // Group by day (YYYY-MM-DD)
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const dates = Object.keys(byDay).sort();
        const values = dates.map(k => byDay[k]);
        if (recordsByDayChart) recordsByDayChart.destroy();
        recordsByDayChart = new Chart(lineCtx, {
            type: 'line',
            data: {
                labels: dates.map(d => new Date(d).toLocaleDateString('th-TH')),
                datasets: [{
                    label: 'จำนวนบันทึกต่อวัน',
                    data: values,
                    borderColor: '#4facfe',
                    fill: false,
                    tension: 0.2,
                    pointRadius: 4
                }]
            },
            options: { plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true } } }
        });
    }

    function buildMachineTrendChart(sortedRecords) {
        const ctx = document.getElementById('machineTrend').getContext('2d');
        if (machineTrendChart) machineTrendChart.destroy();

        machineTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedRecords.map(r => new Date(r.date).toLocaleDateString('th-TH')),
                datasets: [{
                    label: 'แนวโน้มสถานะ (1=ผ่าน, 0=ไม่ผ่าน)',
                    data: sortedRecords.map(r => r.status === 'pass' ? 1 : 0),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.2)',
                    fill: true,
                    tension: 0.2,
                    pointRadius: 4
                }]
            },
            options: {
                scales: { y: { suggestedMin: -0.1, suggestedMax: 1.1, ticks: { stepSize: 1 } } }
            }
        });
    }

    // --- MODALS ---
    function showImageModal(src) {
      document.getElementById('modal-title').textContent = 'รูปภาพการสอบเทียบ';
      document.getElementById('modal-body').innerHTML = `<img class="modal-image" src="${src}" alt="Full size image">`;
      document.getElementById('genericModal').style.display = 'flex';
    }

    function viewRecordDetails(id) {
        const r = records.find(x => x.id === id);
        if (!r) return;
        document.getElementById('modal-title').textContent = `รายละเอียดการสอบเทียบ - ${r.machine}`;
        document.getElementById('modal-body').innerHTML = `
            <div style="line-height:1.8;">
              <p><strong>เครื่องมือ:</strong> ${r.machine}</p>
              <p><strong>ปริมาตร:</strong> ${r.volume} ลิตร</p>
              <p><strong>วันที่สอบเทียบ:</strong> ${new Date(r.date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</p>
              <p><strong>ผลการสอบเทียบ:</strong> ${r.status === 'pass' ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}</p>
              <p><strong>ผู้สอบเทียบ:</strong> ${r.calibrator}</p>
              <p><strong>วันที่บันทึก:</strong> ${new Date(r.timestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</p>
              ${r.notes ? `<p><strong>หมายเหตุ:</strong> ${r.notes}</p>` : ''}
              ${r.image ? `<div style="margin-top:10px;"><img class="modal-image" src="${r.image}" alt="Calibration image"></div>` : ''}
            </div>`;
        document.getElementById('genericModal').style.display = 'flex';
    }

    // --- EXCEL EXPORT ---
    function exportExcel() {
        const recs = records.map(r => ({
            'ID': r.id, 'เครื่อง': r.machine, 'ปริมาตร (ลิตร)': r.volume,
            'วันที่สอบเทียบ': new Date(r.date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }),
            'ผล': r.status, 'ผู้สอบเทียบ': r.calibrator,
            'หมายเหตุ': r.notes || '',
            'เวลาบันทึก': new Date(r.timestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
            'รูปภาพ': r.image || ''
        }));
        const ws1 = XLSX.utils.json_to_sheet(recs);

        const statusByMachine = {};
        Object.keys(machines).forEach(m => statusByMachine[m] = { 'เครื่อง':m, 'ปริมาตร (ลิตร)':machines[m], 'สถานะล่าสุด':'pending', 'วันที่ล่าสุด':'-', 'จำนวนครั้ง':0 });
        records.forEach(r => {
            const cur = statusByMachine[r.machine];
            if (!cur) return;
            cur['จำนวนครั้ง']++;
            if (cur['วันที่ล่าสุด'] === '-' || new Date(r.date) > new Date(cur['วันที่ล่าสุด'])) {
                cur['วันที่ล่าสุด'] = r.date;
                cur['สถานะล่าสุด'] = r.status;
            }
        });
        const summaryData = Object.values(statusByMachine).map(m => ({
            ...m,
            'วันที่ล่าสุด': m['วันที่ล่าสุด'] === '-' ? '-' : new Date(m['วันที่ล่าสุด']).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
        }))
        const ws2 = XLSX.utils.json_to_sheet(summaryData);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws1, 'Records');
        XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
        XLSX.writeFile(wb, `calibration-export-${new Date().toISOString().slice(0,10)}.xlsx`);
    }

    // --- EVENT LISTENERS ---
    document.querySelector('.nav-tabs').addEventListener('click', (e) => {
        if(e.target.matches('.nav-tab')) {
            switchTab(e.target.dataset.tab);
        }
    });

    document.querySelector('.status-buttons').addEventListener('click', (e) => {
        if (e.target.matches('.status-btn')) {
            selectedStatus = e.target.dataset.status;
            document.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
        }
    });

    document.getElementById('add-record-btn').addEventListener('click', addRecord);
    document.getElementById('bulk-delete-btn').addEventListener('click', bulkDelete);
    document.getElementById('export-excel-btn-1').addEventListener('click', exportExcel);
    document.getElementById('export-excel-btn-2').addEventListener('click', exportExcel);
    historyMachineSelect.addEventListener('change', showMachineHistory);

    // Filter listeners
    ['filter-search', 'filter-status', 'filter-calibrator', 'filter-date'].forEach(id => {
        document.getElementById(id).addEventListener('input', renderFilteredRecords);
    });

    // Modal Close Listeners
    document.getElementById('genericModal-close').addEventListener('click', () => {
        document.getElementById('genericModal').style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target.id === 'genericModal') e.target.style.display = 'none';
        if (e.target.id === 'alertModal') e.target.style.display = 'none';
    });

    // Dynamic content listeners
    document.body.addEventListener('click', (e) => {
        const target = e.target;
        // Image preview click
        if (target.matches('.image-preview') && target.dataset.imgSrc) {
            showImageModal(target.dataset.imgSrc);
        }
        // Action buttons in history table
        if (target.dataset.action === 'view' && target.dataset.id) {
            viewRecordDetails(target.dataset.id);
        }
        if (target.dataset.action === 'delete' && target.dataset.id) {
            deleteRecord(target.dataset.id);
        }
    });

    // --- INITIALIZATION ---
    initializeApp();
});
