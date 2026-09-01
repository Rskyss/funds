-- 当天回滚：aum_currency 列被撤掉，但代码里仍在内存中计算币种（lib/eastmoney.mjs parseAumAmount）而从未落库。
-- 结果是 funds.aum_billion 里美元与人民币规模混在一列。已记入 docs/安全加固_1.7.1/验收记录.md 遗留项。
ALTER TABLE funds DROP COLUMN IF EXISTS aum_currency;
