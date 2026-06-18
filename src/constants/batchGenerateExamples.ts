export interface BatchGenerateExample {
  zh: {
    topic: string;
    description: string;
  };
  en: {
    topic: string;
    description: string;
  };
}

export const BATCH_GENERATE_EXAMPLES: BatchGenerateExample[] = [
  { zh: { topic: '后宫权谋', description: '皇帝、皇后、10个妃子、太医、掌事太监和宫女总管' }, en: { topic: 'imperial court intrigue', description: 'an emperor, empress, 10 consorts, an imperial physician, a chief eunuch, and a head maid' } },
  { zh: { topic: '仙侠门派', description: '掌门、剑修大师姐、丹修、阵修、外门弟子、魔修卧底和山门守卫' }, en: { topic: 'xianxia sect', description: 'a sect leader, senior sword disciple, alchemist, formation specialist, outer disciple, demonic spy, and gate guard' } },
  { zh: { topic: '都市急诊科', description: '急诊主任、住院医、护士长、实习医生、社工、患者家属和救护车司机' }, en: { topic: 'urban emergency department', description: 'an ER director, resident, head nurse, intern, social worker, patient family member, and ambulance driver' } },
  { zh: { topic: '火星科研基地', description: '基地指挥官、地质学家、机械工程师、植物学家、通信员、医生和补给飞行员' }, en: { topic: 'Mars research base', description: 'a base commander, geologist, mechanical engineer, botanist, comms officer, doctor, and supply pilot' } },
  { zh: { topic: '海岛求生节目', description: '主持人、退役军人、厨师、医生、网红、摄影师和本地向导' }, en: { topic: 'island survival show', description: 'a host, veteran, chef, doctor, influencer, camera operator, and local guide' } },
  { zh: { topic: '中世纪商会', description: '会长、账房、护卫队长、远行商人、学徒、竞争商人和港口税官' }, en: { topic: 'medieval merchant guild', description: 'a guildmaster, accountant, guard captain, traveling merchant, apprentice, rival trader, and port tax officer' } },
  { zh: { topic: '校园社团', description: '社长、副社长、新人、技术宅、宣传委员、指导老师和隔壁社团对手' }, en: { topic: 'school club', description: 'a president, vice president, newcomer, tech nerd, publicity officer, advisor, and rival club member' } },
  { zh: { topic: '赛博侦探事务所', description: '私家侦探、黑客、前警探、情报贩子、仿生人助手和企业安保主管' }, en: { topic: 'cyberpunk detective agency', description: 'a private detective, hacker, former cop, info broker, android assistant, and corporate security chief' } },
  { zh: { topic: '山村民俗调查', description: '民俗学者、村长、乡村医生、返乡青年、庙祝、老猎人和记者' }, en: { topic: 'rural folklore investigation', description: 'a folklorist, village chief, rural doctor, returning youth, shrine keeper, old hunter, and journalist' } },
  { zh: { topic: '星际走私船', description: '船长、导航员、机械师、医生、货主、逃犯和海关追查员' }, en: { topic: 'interstellar smuggling ship', description: 'a captain, navigator, mechanic, medic, cargo owner, fugitive, and customs investigator' } },
  { zh: { topic: '魔法学院', description: '院长、四个学院学生、图书管理员、魔药老师、决斗冠军和校医' }, en: { topic: 'magic academy', description: 'a headmaster, students from four houses, librarian, potion teacher, dueling champion, and school nurse' } },
  { zh: { topic: '创业公司', description: 'CEO、CTO、产品经理、设计师、运营、投资人、早期用户和竞争对手' }, en: { topic: 'startup company', description: 'a CEO, CTO, product manager, designer, operator, investor, early user, and competitor' } },
  { zh: { topic: '古董修复工坊', description: '修复师、鉴定师、学徒、收藏家、拍卖行代表、文物警察和送货员' }, en: { topic: 'antique restoration workshop', description: 'a restorer, appraiser, apprentice, collector, auction representative, art-crime officer, and courier' } },
  { zh: { topic: '深海科考船', description: '船长、海洋生物学家、潜航器驾驶员、声呐工程师、厨师、赞助方代表和气象员' }, en: { topic: 'deep-sea research vessel', description: 'a captain, marine biologist, submersible pilot, sonar engineer, cook, sponsor representative, and meteorologist' } },
  { zh: { topic: '奇幻佣兵团', description: '团长、盾战士、游侠、治疗者、吟游诗人、雇主和敌对佣兵' }, en: { topic: 'fantasy mercenary company', description: 'a leader, shield fighter, ranger, healer, bard, employer, and rival mercenary' } },
  { zh: { topic: '刑侦专案组', description: '组长、法医、痕检员、画像师、网安警员、线人和检察官' }, en: { topic: 'criminal investigation task force', description: 'a team lead, forensic doctor, trace analyst, profiler, cyber officer, informant, and prosecutor' } },
  { zh: { topic: '美食街摊主联盟', description: '烧烤摊主、甜品师、面馆老板、外卖骑手、城管、食评人和房东' }, en: { topic: 'street food vendor alliance', description: 'a grill vendor, dessert maker, noodle shop owner, delivery rider, inspector, food critic, and landlord' } },
  { zh: { topic: '末日避难所', description: '避难所负责人、医生、农艺师、维修工、巡逻员、外来幸存者和物资管理员' }, en: { topic: 'post-apocalyptic shelter', description: 'a shelter leader, doctor, agronomist, mechanic, patrol guard, outsider survivor, and quartermaster' } },
  { zh: { topic: '王国继承危机', description: '国王、王储、二王子、摄政大臣、骑士长、宫廷法师和边境领主' }, en: { topic: 'kingdom succession crisis', description: 'a king, crown heir, second prince, regent, knight captain, court mage, and border lord' } },
  { zh: { topic: '独立游戏工作室', description: '主策划、程序、美术、音频设计、发行经理、主播玩家和外包测试员' }, en: { topic: 'indie game studio', description: 'a lead designer, programmer, artist, audio designer, publishing manager, streamer player, and outsourced tester' } },
  { zh: { topic: '动物诊所', description: '兽医、护士、前台、宠物美容师、训犬师、焦虑宠物主人和流浪动物救助者' }, en: { topic: 'animal clinic', description: 'a veterinarian, nurse, receptionist, groomer, dog trainer, anxious pet owner, and stray animal rescuer' } },
  { zh: { topic: '时间旅行管理局', description: '行动队长、历史顾问、技术员、档案员、违规旅客、监察官和新人探员' }, en: { topic: 'time travel bureau', description: 'an operations lead, history advisor, technician, archivist, illegal traveler, inspector, and rookie agent' } },
  { zh: { topic: '古代客栈', description: '掌柜、跑堂、厨娘、镖师、书生、神秘住客和追债人' }, en: { topic: 'ancient roadside inn', description: 'an innkeeper, waiter, cook, escort guard, scholar, mysterious guest, and debt collector' } },
  { zh: { topic: '太空移民船', description: '舰长、休眠舱工程师、生态舱管理员、教育官、安保队长、移民代表和叛逃技术员' }, en: { topic: 'space colony ship', description: 'a captain, cryopod engineer, biosphere manager, education officer, security chief, colonist representative, and defecting technician' } },
  { zh: { topic: '高校实验室', description: '教授、博士后、博士生、硕士生、实验管理员、企业合作方和伦理委员' }, en: { topic: 'university laboratory', description: 'a professor, postdoc, PhD student, master student, lab manager, industry partner, and ethics board member' } },
  { zh: { topic: '黑帮家族谈判', description: '家族首领、继承人、军师、打手、会计、对手家族代表和中间人' }, en: { topic: 'crime family negotiation', description: 'a family boss, heir, strategist, enforcer, accountant, rival family representative, and mediator' } },
  { zh: { topic: '乡镇医院', description: '院长、全科医生、护士、药剂师、村医、慢病患者和上级医院专家' }, en: { topic: 'township hospital', description: 'a director, general practitioner, nurse, pharmacist, village doctor, chronic patient, and visiting specialist' } },
  { zh: { topic: '蒸汽朋克飞艇', description: '船长、机械师、贵族乘客、报童、空贼、导航员和保险调查员' }, en: { topic: 'steampunk airship', description: 'a captain, engineer, noble passenger, newsboy, sky pirate, navigator, and insurance investigator' } },
  { zh: { topic: '城市规划听证会', description: '规划师、开发商、老社区居民、环保志愿者、交通专家、媒体记者和区议员' }, en: { topic: 'urban planning hearing', description: 'a planner, developer, old-neighborhood resident, environmental volunteer, traffic expert, journalist, and district councilor' } },
  { zh: { topic: '博物馆夜班', description: '保安、策展人、修复师、实习生、清洁工、捐赠人和文物走私线人' }, en: { topic: 'museum night shift', description: 'a guard, curator, restorer, intern, cleaner, donor, and artifact-smuggling informant' } },
  { zh: { topic: '电竞战队', description: '队长、突击手、指挥、替补、教练、数据分析师、粉丝站长和赞助商代表' }, en: { topic: 'esports team', description: 'a captain, entry fragger, shotcaller, substitute, coach, data analyst, fan-site admin, and sponsor representative' } },
  { zh: { topic: '荒漠考古队', description: '领队、考古学家、翻译、司机、摄影师、当地向导和盗墓者卧底' }, en: { topic: 'desert archaeology team', description: 'a team leader, archaeologist, translator, driver, photographer, local guide, and tomb-raider infiltrator' } },
  { zh: { topic: '机器人维修店', description: '店主、硬件技师、软件工程师、旧型号机器人、投诉客户、零件商和监管员' }, en: { topic: 'robot repair shop', description: 'a shop owner, hardware technician, software engineer, old-model robot, complaining customer, parts dealer, and regulator' } },
  { zh: { topic: '家族农场', description: '祖父、接班孙女、兽医、邻居、采购商、季节工和农业顾问' }, en: { topic: 'family farm', description: 'a grandfather, granddaughter successor, veterinarian, neighbor, buyer, seasonal worker, and agricultural consultant' } },
  { zh: { topic: '现代修仙事务所', description: '事务所老板、符箓师、法律顾问、妖怪客户、实习生、竞争同行和物业经理' }, en: { topic: 'modern cultivation agency', description: 'an agency owner, talisman specialist, legal advisor, monster client, intern, rival practitioner, and property manager' } },
  { zh: { topic: '音乐剧团', description: '导演、女主角、替补演员、作曲、舞台监督、灯光师、投资人和剧评人' }, en: { topic: 'musical theater troupe', description: 'a director, lead actress, understudy, composer, stage manager, lighting designer, investor, and critic' } },
  { zh: { topic: '气象灾害指挥中心', description: '指挥长、预报员、水利专家、电力抢修负责人、社区志愿者、记者和被困居民' }, en: { topic: 'weather disaster command center', description: 'a commander, forecaster, water-control expert, power repair lead, community volunteer, reporter, and trapped resident' } },
  { zh: { topic: '妖怪公寓', description: '房东、狐妖租客、河童维修工、人类新住户、除妖师、快递员和业委会代表' }, en: { topic: 'monster apartment building', description: 'a landlord, fox-spirit tenant, kappa repair worker, new human resident, exorcist, courier, and residents committee representative' } },
  { zh: { topic: '国际列车悬疑', description: '列车长、乘警、富商、翻译、记者、魔术师、医生和失踪乘客的同伴' }, en: { topic: 'international train mystery', description: 'a conductor, railway police officer, tycoon, translator, journalist, magician, doctor, and missing passenger companion' } },
  { zh: { topic: '童话动物村', description: '村长、邮差、面包师、发明家、森林巡护员、顽皮幼崽和外来商人' }, en: { topic: 'fairy-tale animal village', description: 'a mayor, post carrier, baker, inventor, forest ranger, mischievous cub, and traveling merchant' } },
];
