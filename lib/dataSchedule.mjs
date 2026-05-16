const TZ = "Asia/Shanghai";

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function parseDataUpdateSchedule() {
  const raw = (process.env.DATA_UPDATE_TIME || "07:00").trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { hour: 7, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}

function shanghaiParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function slotTimestamp(year, month, day, hour, minute) {
  return new Date(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00+08:00`,
  );
}

function previousShanghaiDay(year, month, day) {
  const noon = new Date(`${year}-${pad2(month)}-${pad2(day)}T12:00:00+08:00`);
  noon.setUTCDate(noon.getUTCDate() - 1);
  const p = shanghaiParts(noon);
  return { year: p.year, month: p.month, day: p.day };
}

/** 最近一次「不晚于实际入库时间」的定时更新时刻（Asia/Shanghai） */
export function scheduledUpdateBefore(actualIso) {
  if (!actualIso) return null;
  const actual = new Date(actualIso);
  if (Number.isNaN(actual.getTime())) return null;

  const { hour, minute } = parseDataUpdateSchedule();
  const { year, month, day } = shanghaiParts(actual);
  let slot = slotTimestamp(year, month, day, hour, minute);
  if (actual.getTime() < slot.getTime()) {
    const prev = previousShanghaiDay(year, month, day);
    slot = slotTimestamp(prev.year, prev.month, prev.day, hour, minute);
  }
  return slot;
}

export function formatDataUpdateTimeText(date) {
  if (!date || Number.isNaN(date.getTime())) return "暂无";
  const p = shanghaiParts(date);
  return `${p.year}/${p.month}/${p.day} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function formatDataUpdateDisplay(actualIso) {
  const slot = scheduledUpdateBefore(actualIso);
  if (!slot) {
    return { fetchedAt: null, fetchedAtText: "暂无", updateSchedule: parseDataUpdateSchedule() };
  }
  return {
    fetchedAt: slot.getTime(),
    fetchedAtText: formatDataUpdateTimeText(slot),
    updateSchedule: parseDataUpdateSchedule(),
  };
}
