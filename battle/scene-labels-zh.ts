// zh_CN variants of the game-owned scene label blocks (PC storage, monster
// shop, daycare, scripted trade). The kit's own UI strings stay English
// (KUI1 pending); these are the game content labels. Placeholders ({name},
// {box}, {price}, {sent}, {received}) are substituted at runtime and kept
// identical to the English blocks.

import type { DaycareLabels } from "./daycare-scenes.ts";
import type { MonsterShopLabels, PcLabels } from "./storage-scenes.ts";

export const PC_LABELS_ZH: PcLabels = {
  title: "电脑",
  pickUp: "取出精灵",
  dropOff: "存入精灵",
  logOff: "退出",
  pick: "取出",
  moveTo: "移动到 {box}",
  release: "放生",
  cancel: "取消",
  yes: "是",
  no: "否",
  empty: "这个寄存处是空的，没有精灵可以取出。",
  full: "这个寄存处已满。",
  added: "你把 {name} 加入了队伍！",
  stored: "{name} 已存入 {box}。",
  moved: "{name} 已移动到 {box}。",
  releaseConfirm: "你确定要放生 {name} 吗？",
  released: "{name} 已被放生。",
  lastMonster: "{name} 是你最后一只还能战斗的精灵。",
};

export const MONSTER_SHOP_LABELS_ZH: MonsterShopLabels = {
  title: "精灵",
  buy: "购买",
  cancel: "取消",
  confirm: "用 ${price} 购买 {name}？",
  bought: "你买下了 {name}！",
  tooExpensive: "你的钱不够",
  soldOut: "已售罄！",
  noRoom: "队伍里没有空位了。",
};

export const TRADE_MESSAGE_ZH = "你用 {sent} 交换，得到了 {received}！";

export const DAYCARE_LABELS_ZH: DaycareLabels = {
  summary: "培育屋概况",
  parents: "培育屋中的父母",
  empty: "没有寄存精灵。",
  mode: "模式",
  thanks: "感谢使用培育屋！",
  add: "寄存精灵",
  withdraw: "全部取出",
  collect: "领取新生精灵",
  modeTraining: "训练",
  modeBreeding: "培育",
  modeIncompatible: "训练（配对不合）",
  modeEmpty: "空闲",
  training: "训练信息",
  expTotal: "获得经验总值",
  costTotal: "已付费用总值",
  expPerStep: "每步经验（每只精灵）",
  costPerStep: "每步费用（每只精灵）",
  expPerStepTotal: "每步经验总计",
  costPerStepTotal: "每步费用总计",
  trainingSingle: "训练中（1 只精灵）",
  trainingDouble: "训练中（2 只精灵）",
  trainingInactive: "未在训练",
  breeding: "培育信息",
  progress: "进度",
  ready: "新生精灵已就绪！",
  halfway: "已到一半",
  notReady: "尚未就绪",
  noBreeding: "无法培育。",
  full: "这个寄存处已满。",
  select: "选择",
  back: "返回",
  upKey: "上键",
  downKey: "下键",
  leftKey: "左键",
  rightKey: "右键",
  primaryKey: "确认键",
  secondaryKey: "取消键",
  male: "雄性",
  female: "雌性",
  neuter: "无性别",
};
