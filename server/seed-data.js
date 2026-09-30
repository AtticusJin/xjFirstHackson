/* 虚构 Demo 选手池 —— 正式版用 server/import-csv.js 导入飞书导出的 CSV 替换 */
const AV = [
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/TBJTb2Mzcoa1wixbugXcLYSKn5g',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/QIirbTnqcoPjOwx8ESucKgoZnui',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/NEFabViD5owsKUxFrT1c2yAbnPf',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/W01RbY6wHoabHkx2qwFc5wa7nCh',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/HeoPbEO2oocfMhxanQDcINV1np0',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/UcgobADHOoVJUHxYIhpcl1BZnFg',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/ShoobNfU8ovuWvxhIt2cNVvJnBd',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/AFcbbmEymo7q5fxHkPBcs3gXnTd',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/EnoHbNHVso9pKhxv7iacblOqnZc',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/HtZmbhnLJoFTjPxoewfcGjYVnwf',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/Ri6LbkWQYoKRnJxP1Wicum2rnye',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/ZpG0bqZ4RoIpOKxu5FLc419znrh',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/MjVTbsqoHojdFSxNQ5ecSWcEnPg',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/OKeCbb3cSoksF7xAQTJcrYdrnbd',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/Zpv6bxDkAo1idtxsl9tc6gOInoe',
  'https://media.doubao.com/space/api/box/stream/download/all_by_mount_point/ZwO1b96iQo3sATxIMKJcF6Jfnbe'
];

/* 字段与飞书报名表对齐：name/nickname/role/grade/dorm/intro/tags/wechat/avatar
   wechat 是认领时校验用的"报名时登记的微信号"，正式数据由 CSV 导入 */
const PLAYERS = [
  { name:'林一诺', nickname:'yinuo.dev', role:'开发', grade:'学军中学·高二', dorm:'1号楼202', intro:'写过每秒百万请求的接口，想找个前端一起卷', tags:'Go Python 后端', wechat:'yinuo_dev' },
  { name:'陈思远', nickname:'siyuan.c', role:'开发', grade:'学军中学·高二', dorm:'2号楼108', intro:'信竞选手，48小时拿个能跑的东西Demo', tags:'C++ Qt 算法', wechat:'siyuan_c' },
  { name:'苏念安', nickname:'nianan.s', role:'设计', grade:'杭外·高二', dorm:'3号楼204', intro:'像素插画师，想让评委一眼记住我们的Demo', tags:'Figma 动效 插画', wechat:'nianan_s' },
  { name:'赵一鸣', nickname:'yiming.z', role:'产品', grade:'学军中学·高二', dorm:'1号楼405', intro:'产品经理，擅长把点子变成讲得清的故事', tags:'需求拆解 落地 文档', wechat:'yiming_z' },
  { name:'顾之夏', nickname:'zhixia.g', role:'运营', grade:'学军中学·高一', dorm:'3号楼118', intro:'能拉200人内测，斩获一个硬核产品', tags:'内容 社群 增长', wechat:'zhixia_g' },
  { name:'周子墨', nickname:'zimo.z', role:'开发', grade:'学军中学·高二', dorm:'2号楼310', intro:'做过三个游戏Demo，这次想做个真能玩的', tags:'Unity Godot 游戏', wechat:'zimo_z' },
  { name:'何云帆', nickname:'yunfan.h', role:'硬件', grade:'学军中学·高一', dorm:'1号楼312', intro:'手上有三块开发板，现场48小时焊一个', tags:'嵌入式 传感器 PCB', wechat:'yunfan_h' },
  { name:'唐若溪', nickname:'ruoxi.t', role:'设计', grade:'学军中学·高三', dorm:'2号楼316', intro:'7项AI认证，负责把方案讲成评委记住的故事', tags:'AI工作流 PPT 剪辑', wechat:'ruoxi_t' },
  { name:'沈嘉禾', nickname:'jiahe.s', role:'开发', grade:'学军中学·高二', dorm:'1号楼209', intro:'数据清洗小能手，缺一个敢想敢做的队友', tags:'Python 爬虫 数据分析', wechat:'jiahe_s' },
  { name:'陆明轩', nickname:'mingxuan.l', role:'开发', grade:'学军中学·高三', dorm:'3号楼407', intro:'DBMS爱好者，想看看大家AI都干了啥', tags:'Rust 系统 CLI', wechat:'mingxuan_l' },
  { name:'许清欢', nickname:'qinghuan.x', role:'产品', grade:'学军中学·高二', dorm:'2号楼119', intro:'做过20+次用户访谈，知道痛点藏在哪儿', tags:'用户研究 访谈 原型', wechat:'qinghuan_x' },
  { name:'韩子昂', nickname:'ziang.h', role:'硬件', grade:'学军中学·高二', dorm:'1号楼306', intro:'有台3D打印机，现场快速打样喊我', tags:'Arduino 3D打印 机器人', wechat:'ziang_h' },
  { name:'叶诗涵', nickname:'shihan.y', role:'运营', grade:'学军中学·高二', dorm:'3号楼222', intro:'私域1W+用户，能把Demo讲得有人信', tags:'私域 小红书 转化', wechat:'shihan_y' },
  { name:'高启铭', nickname:'qiming.g', role:'开发', grade:'学军中学·高三', dorm:'2号楼301', intro:'研究Agentic RL，想趁48小时做点真的', tags:'RL Agent 大模型', wechat:'qiming_g' },
  { name:'方若云', nickname:'ruoyun.f', role:'设计', grade:'学军中学·高一', dorm:'3号楼218', intro:'主观视觉交给我，别让Demo输在孔上', tags:'品牌 海报 视觉系统', wechat:'ruoyun_f' },
  { name:'王子睿', nickname:'zirui.w', role:'开发', grade:'学军中学·高一', dorm:'1号楼608', intro:'写过macOS Agent，这次想上点原生体验', tags:'Swift iOS 前端', wechat:'zirui_w' }
];

const SCHEDULES = [
  { day:'DAY1', time:'09:00', title:'开赛仪式 · 题目公布', desc:'48H 计时开始', status:'done', sort:1 },
  { day:'DAY1', time:'09:30', title:'自由组队（线上 + 线下）', desc:'组队广场开放，认领身份后可互相表达意向', status:'now', sort:2 },
  { day:'DAY1', time:'12:00', title:'组队截止', desc:'未找到队友的选手进入等待池，由组委会随机补位', status:'todo', sort:3 },
  { day:'DAY1', time:'18:00', title:'Checkpoint · 进度同步', desc:'各队提交一页进度截图 + 三行说明', status:'todo', sort:4 },
  { day:'DAY2', time:'09:00', title:'开发冲刺 · 第二轮', desc:'代码冻结前最后 8 小时', status:'todo', sort:5 },
  { day:'DAY2', time:'15:00', title:'Demo 路演 · 3号报告厅', desc:'每队 3 分钟演示 + 2 分钟 Q&A', status:'todo', sort:6 },
  { day:'DAY2', time:'17:30', title:'评审与颁奖', desc:'最佳 Demo 直通校科创节主舞台', status:'todo', sort:7 }
];

const ANNOUNCEMENTS = [
  { tag:'重要', title:'组队截止：组队广场 12:00 关闭', body:'未找到队友的选手将自动进入等待池，由组委会随机补位。', time:'DAY1 12:00', pinned:1 },
  { tag:'Checkpoint', title:'今晚 18:00 进度同步', body:'各队提交一页进度截图+三行说明，发到赛事群接龙。', time:'DAY1 18:00', pinned:0 },
  { tag:'场地', title:'Demo 路演在 3 号报告厅', body:'座位先到先得，建议提前 20 分钟到场调试投影与网络。', time:'DAY2 15:00', pinned:0 },
  { tag:'评审', title:'最佳 Demo 直通校科创节主舞台', body:'评委团 5 人，评分维度：完成度 / 创意 / 演示表现。', time:'DAY2 17:30', pinned:0 }
];

module.exports = { PLAYERS, SCHEDULES, ANNOUNCEMENTS, AV };
