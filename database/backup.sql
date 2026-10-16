-- Print Floor ERP — database backup
-- Created 2026-10-15 for MySQL 5.7+/8 and MariaDB 10.4+ (Hostinger).
-- Import into an EMPTY database with phpMyAdmin (Import tab) or:  mysql -u USER -p DBNAME < backup.sql
-- Contains: all tables, your current records, and the owner login
--   username: jeet   temporary password: ChangeMe@123   (the app asks you to set a new one at first login)


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `app_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_settings` (
  `k` varchar(64) NOT NULL,
  `v` text NOT NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `app_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `app_settings` ENABLE KEYS */;
DROP TABLE IF EXISTS `collection_versions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `collection_versions` (
  `collection` varchar(64) NOT NULL,
  `ver` bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY (`collection`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `collection_versions` DISABLE KEYS */;
INSERT INTO `collection_versions` VALUES
('customers',1),
('grn',1),
('items',1),
('jobs',2),
('locs',8),
('machines',1),
('meta',1),
('mv',1),
('paper',3),
('pins',3),
('plates',1),
('prices',4),
('settings',1),
('so',1),
('workers',1);
/*!40000 ALTER TABLE `collection_versions` ENABLE KEYS */;
DROP TABLE IF EXISTS `documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `documents` (
  `collection` varchar(64) NOT NULL,
  `id` varchar(191) NOT NULL,
  `data` longtext NOT NULL,
  `m` varchar(64) DEFAULT NULL COMMENT 'copy of data.m (month key) for fast monthly queries',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_by` varchar(40) DEFAULT NULL,
  `updated_by` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`collection`,`id`),
  KEY `idx_documents_coll_m` (`collection`,`m`),
  KEY `idx_documents_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `documents` DISABLE KEYS */;
INSERT INTO `documents` VALUES
('customers','b7cupjkqqxc6mteuq57n','{\"address\":\"Bhiwandi, Thane, 421302\",\"city\":\"Bhiwandi\",\"gst\":\"27AAEPS3314H1ZS\",\"name\":\"Gurudev Traders\",\"phone\":\"9664338395\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('grn','zaaq2po7thvi05d92uii','{\"bill\":\"12345\",\"billDate\":\"2026-10-11\",\"created\":\"2026-10-11\",\"date\":\"2026-10-11\",\"lines\":[{\"cat\":\"Ink\",\"itemId\":\"67bpk22vczb87hlkjcr1\",\"micron\":\"\",\"name\":\"Ink black\",\"qty\":100,\"rej\":0,\"size\":\"Na\",\"sunit\":\"in\",\"unit\":\"kg\"}],\"no\":1,\"notes\":\"\",\"recBy\":\"Kumar\",\"supplier\":\"Vaps\",\"vehicle\":\"MH04JU0564\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('items','67bpk22vczb87hlkjcr1','{\"cat\":\"Ink\",\"loc\":\"Store Room\",\"micron\":\"\",\"min\":\"10\",\"name\":\"Ink black\",\"opening\":0,\"size\":\"Na\",\"sunit\":\"in\",\"unit\":\"kg\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('jobs','rwwtje60wkaaod57akxv','{\"colors\":\"1+0\",\"created\":\"2026-10-11\",\"customer\":\"Gurudev Traders\",\"disp\":[{\"at\":1791721329235,\"d\":\"2026-10-11\",\"no\":1,\"note\":\"\",\"pk\":\"40\",\"q\":100000,\"tr\":\"Ranjit\",\"veh\":\"MH04JU0564\"},{\"at\":1791722696732,\"d\":\"2026-10-11\",\"no\":2,\"note\":\"\",\"pk\":\"40\",\"q\":100000,\"tr\":\"Ranjit\",\"veh\":\"MH04JU0564\"}],\"dispatched\":\"2026-10-11\",\"due\":\"2026-10-16\",\"fabDone\":[{\"d\":\"2026-10-11\",\"i\":0,\"note\":\"\",\"process\":\"Lamination gloss\",\"q\":100000},{\"d\":\"2026-10-11\",\"i\":1,\"note\":\"\",\"process\":\"Spot UV\",\"q\":100000}],\"finishing\":\"NA\",\"inward\":[{\"at\":1791721306540,\"d\":\"2026-10-12\",\"note\":\"40\",\"q\":100000},{\"at\":1791722672968,\"d\":\"2026-10-11\",\"note\":\"40\",\"q\":100000}],\"item\":\"Raymond Red\",\"log\":[{\"d\":\"2026-10-11\",\"s\":0},{\"d\":\"2026-10-11\",\"s\":1},{\"d\":\"2026-10-11\",\"s\":2},{\"d\":\"2026-10-11\",\"s\":3},{\"d\":\"2026-10-11\",\"s\":4},{\"d\":\"2026-10-11\",\"s\":5},{\"d\":\"2026-10-11\",\"s\":6},{\"d\":\"2026-10-11\",\"s\":5},{\"d\":\"2026-10-11\",\"s\":4},{\"d\":\"2026-10-11\",\"s\":3},{\"d\":\"2026-10-11\",\"s\":2},{\"d\":\"2026-10-11\",\"s\":1},{\"d\":\"2026-10-11\",\"s\":0},{\"d\":\"2026-10-11\",\"s\":1},{\"d\":\"2026-10-11\",\"s\":2},{\"d\":\"2026-10-11\",\"s\":3},{\"d\":\"2026-10-11\",\"s\":4},{\"d\":\"2026-10-11\",\"s\":5},{\"d\":\"2026-10-11\",\"s\":6}],\"no\":1,\"notes\":\"Paper: Maplitho. Starpping for 2000 pcs\",\"paperId\":\"q0qbr5sjtlp5zf5rwr7h\",\"paperSpec\":\"Maplitho\",\"paperSrc\":\"party\",\"plan\":{\"consumables\":[{\"item\":\"Ink black\",\"qty\":\"10\",\"unit\":\"kg\"}],\"cutL\":406.4,\"cutW\":838.2,\"cuts\":1,\"fab\":[{\"details\":\"Front Lamination only\",\"jw\":\"Without material\",\"lfilm\":\"BOPP 10 micron\",\"lkg\":315.41,\"ll\":\"16\",\"lsheets\":\"100000\",\"lsides\":\"1\",\"lspk\":317.05,\"lw\":\"33\",\"machine\":\"\",\"mode\":\"Outsource\",\"process\":\"Lamination gloss\",\"remark\":\"\",\"worker\":\"Aalam\"},{\"details\":\"\",\"jw\":\"\",\"machine\":\"\",\"mode\":\"In house\",\"process\":\"Spot UV\",\"remark\":\"\",\"worker\":\"\"}],\"fullSheets\":100000,\"machine\":\"rj9jwf6x2kykhxp401wu\",\"planned\":\"2026-10-11\",\"plates\":{\"count\":1,\"ids\":[\"wt6zzyfus7p4k3jhuxl9\"],\"notes\":\"\",\"size\":\"800x1030\",\"type\":\"CTP new\"},\"printSheets\":100000,\"ups\":1,\"waste\":0},\"ptype\":\"Other\",\"qty\":100000,\"size\":\"16x33\",\"soId\":\"s6tmx0ql4ltn8a3r5h63\",\"soLine\":0,\"soNo\":\"SO-0001\",\"stage\":6}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('jobs','yt6xqtebkga5y0ibk7y1','{\"colors\":\"4+4\",\"created\":\"2026-10-11\",\"customer\":\"Gurudev Traders\",\"due\":\"2026-10-19\",\"finishing\":\"Lamination\",\"item\":\"Cover\",\"log\":[{\"d\":\"2026-10-11\",\"s\":0}],\"no\":2,\"notes\":\"\",\"paperId\":\"\",\"paperSrc\":\"party\",\"ptype\":\"Book\",\"qty\":\"5000\",\"size\":\"58.5x89cm\",\"stage\":0,\"withJob\":\"\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','7xs4qut5m2n9gcg82qp6','{\"kind\":\"factory\",\"name\":\"Printing Factory\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','9sqsz4ewg1ko1rp0mnc1','{\"kind\":\"gala\",\"name\":\"H-5\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','gn8muvlc2ty1m8a8vrpw','{\"kind\":\"floor\",\"name\":\"Mezzanine\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','gvxo4waz07vqf8dp250e','{\"kind\":\"pillar\",\"name\":\"1\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','kyrxx46vjm8fnqmm6qcg','{\"kind\":\"floor\",\"name\":\"2nd\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','lb50tj442t51vvzh9m6z','{\"kind\":\"floor\",\"name\":\"1st\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','sgpp83fbvgp7g9zvu6tq','{\"kind\":\"floor\",\"name\":\"3rd\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('locs','zkwd1cpr3d7n1axjhtyf','{\"kind\":\"floor\",\"name\":\"Ground\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('machines','rj9jwf6x2kykhxp401wu','{\"name\":\"Komori L440\",\"notes\":\"28x40 inches\",\"type\":\"Printing\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('meta','pinCounter','{\"n\":4,\"pre\":\"\",\"w\":4}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('mv','2026-10','{\"items\":[{\"at\":1791721143081,\"date\":\"2026-10-11\",\"id\":\"mv3sia09qv9jr\",\"jobId\":\"rwwtje60wkaaod57akxv\",\"jobNo\":\"J-0001\",\"note\":\"\",\"paperId\":\"q0qbr5sjtlp5zf5rwr7h\",\"pin\":\"0001\",\"qty\":-100000}]}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('paper','28gdozmumw8k2172wajr','{\"bill\":\"12345\",\"factory\":\"Printing Factory\",\"floor\":\"Ground\",\"gala\":\"H-5\",\"gsm\":\"75\",\"inDate\":\"2026-10-11\",\"lin\":\"\",\"lmm\":585,\"min\":\"10\",\"name\":\"Maplitho\",\"needsVerify\":true,\"opening\":1000000,\"packing\":\"2000\",\"party\":\"\",\"pillar\":\"1\",\"pin\":\"0003\",\"supply\":\"own\",\"unit\":\"reams\",\"verified\":{\"at\":1791723109243,\"by\":\"u_bh_SHd58Bri5ye81Tlb_Iw\",\"d\":\"2026-10-11\"},\"win\":\"\",\"wmm\":890}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('paper','q0qbr5sjtlp5zf5rwr7h','{\"bill\":\"12345\",\"factory\":\"Printing Factory\",\"floor\":\"Ground\",\"gala\":\"H-5\",\"gsm\":\"50\",\"inDate\":\"2026-10-11\",\"lin\":16,\"lmm\":406,\"min\":\"10000\",\"name\":\"Maplitho\",\"needsVerify\":true,\"opening\":100000,\"packing\":\"40 bundles × 5 Reams × 500 sheets\",\"party\":\"Gurudev Traders\",\"pillar\":\"1\",\"pin\":\"0001\",\"supply\":\"party\",\"unit\":\"sheets\",\"verified\":{\"at\":1791719377119,\"by\":\"u_bh_SHd58Bri5ye81Tlb_Iw\",\"d\":\"2026-10-11\"},\"win\":33,\"wmm\":838}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('paper','wzm5zskhkmkkb4rwqb0k','{\"bill\":\"124t5\",\"factory\":\"Printing Factory\",\"floor\":\"Ground\",\"gala\":\"H-5\",\"gsm\":\"70\",\"inDate\":\"2026-10-11\",\"lin\":\"\",\"lmm\":585,\"min\":\"1000\",\"name\":\"Maplitho\",\"needsVerify\":true,\"opening\":1000000,\"packing\":\"1000x500\",\"party\":\"\",\"pillar\":\"\",\"pin\":\"0004\",\"supply\":\"own\",\"unit\":\"sheets\",\"verified\":{\"at\":1791723114403,\"by\":\"u_bh_SHd58Bri5ye81Tlb_Iw\",\"d\":\"2026-10-11\"},\"win\":\"\",\"wmm\":890}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('pins','p_0001','{\"paperId\":\"q0qbr5sjtlp5zf5rwr7h\",\"pin\":\"0001\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('pins','p_0003','{\"paperId\":\"28gdozmumw8k2172wajr\",\"pin\":\"0003\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('pins','p_0004','{\"paperId\":\"wzm5zskhkmkkb4rwqb0k\",\"pin\":\"0004\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('plates','wt6zzyfus7p4k3jhuxl9','{\"bill\":\"12345\",\"date\":\"2026-10-11\",\"loc\":\"34\",\"notes\":\"\",\"pno\":\"PL-0001\",\"qty\":1,\"ref\":\"Raymond Red\",\"sets\":[{\"form\":\"Single sheet\",\"n\":1,\"pps\":1}],\"size\":\"800x1030\",\"type\":\"CTP new\",\"vendor\":\"Varna Grafics\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('prices','grn_zaaq2po7thvi05d92uii','{\"byItem\":{\"67bpk22vczb87hlkjcr1\":{\"gst\":18,\"rate\":500}}}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('prices','items_67bpk22vczb87hlkjcr1','{\"rate\":\"500\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('prices','jobs_rwwtje60wkaaod57akxv','{\"fab\":[{\"process\":\"Lamination gloss\",\"rate\":\"TBD\",\"runit\":\"per 1,000\"},{\"process\":\"Spot UV\",\"rate\":\"\",\"runit\":\"\"}],\"rate\":0.2}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('prices','jobs_yt6xqtebkga5y0ibk7y1','{\"fab\":[],\"rate\":\"\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('settings','lists','{\"scat\":[\"Ink\",\"Plates\",\"Chemicals\",\"Lamination film\",\"Varnish & coating\",\"Foil\",\"Adhesive / glue\",\"Blankets & rollers\",\"Packing material\",\"Spares\",\"Other raw material\",\"Other consumable\",\"Punch\"]}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('so','s6tmx0ql4ltn8a3r5h63','{\"approved\":{\"at\":1791717952220,\"by\":\"u_bh_SHd58Bri5ye81Tlb_Iw\",\"d\":\"2026-10-11\"},\"by\":\"u_bh_SHd58Bri5ye81Tlb_Iw\",\"contact\":\"Sumit Bhai\",\"created\":\"2026-10-11\",\"customer\":\"Gurudev Traders\",\"date\":\"2026-10-11\",\"delAt\":\"\",\"due\":\"2026-10-16\",\"lines\":[{\"colors\":\"1+0\",\"finishing\":\"NA\",\"gst\":18,\"item\":\"Raymond Red\",\"jobId\":\"rwwtje60wkaaod57akxv\",\"notes\":\"Starpping for 2000 pcs\",\"paper\":\"Maplitho\",\"paperSrc\":\"party\",\"ptype\":\"Other\",\"qty\":100000,\"rate\":0.2,\"size\":\"16x33\"}],\"no\":1,\"notes\":\"\",\"payDays\":\"30\",\"po\":\"Verbal Order\",\"poDate\":\"2026-10-11\",\"sentOn\":\"2026-10-11\",\"status\":\"sent\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL),
('workers','0dclzrdy682aqnm2za6l','{\"name\":\"Aalam\"}',NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07',NULL,NULL);
/*!40000 ALTER TABLE `documents` ENABLE KEYS */;
DROP TABLE IF EXISTS `leases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leases` (
  `collection` varchar(64) NOT NULL,
  `id` varchar(191) NOT NULL,
  `holder` varchar(191) NOT NULL,
  `expires_at` bigint(20) NOT NULL,
  PRIMARY KEY (`collection`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `leases` DISABLE KEYS */;
/*!40000 ALTER TABLE `leases` ENABLE KEYS */;
DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `name` varchar(191) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `schema_migrations` DISABLE KEYS */;
INSERT INTO `schema_migrations` VALUES
('001_init.sql','2026-10-15 08:25:07');
/*!40000 ALTER TABLE `schema_migrations` ENABLE KEYS */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(40) NOT NULL,
  `username` varchar(60) NOT NULL,
  `name` varchar(120) NOT NULL,
  `password_hash` varchar(100) NOT NULL,
  `role` varchar(20) NOT NULL DEFAULT 'factory',
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  `token_version` int(11) NOT NULL DEFAULT 0,
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
('u_bh_SHd58Bri5ye81Tlb_Iw','jeet','Jeet Shah','$2a$10$ovqY1Xu2rBB1SaebSjlaPe9dSV1FE2K2Y3aeDkRuUz.T87z0s4nm6','owner',1,1,0,NULL,'2026-10-15 08:25:07','2026-10-15 08:25:07');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

