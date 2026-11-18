
/* FARM SUMMARY */
.farm-summary {
  background: #14161a;
  border: 1px solid var(--line);
  padding: 12px;
  margin-bottom: 12px;
}

.farm-summary-title {
  color: var(--muted);
  font-size: 9px;
  letter-spacing: 1.5px;
  margin-bottom: 12px;
}

.farm-devices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}

.farm-device {
  background: #1d2026;
  border: 1px solid #343740;
  padding: 11px;
}

.device-label {
  display: block;
  color: var(--gold);
  font-size: 9px;
  margin-bottom: 8px;
}

.farm-device b {
  display: block;
  font-size: 22px;
  color: var(--white);
  margin-bottom: 7px;
}

.farm-device small {
  color: var(--green);
  font-size: 8px;
}

.farm-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--line);
  margin-top: 11px;
  padding-top: 11px;
}

.farm-total span {
  color: var(--muted);
  font-size: 8px;
}

.farm-total b {
  color: var(--gold);
  font-size: 10px;
  white-space: nowrap;
}
