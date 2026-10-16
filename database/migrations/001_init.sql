-- 001_init: core tables for the ERP.
-- Works on MySQL 5.7+/8.x and MariaDB 10.4+ (Hostinger shared hosting runs MariaDB).

-- People who can log in. role: owner | accounts | factory | none
CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(40)  NOT NULL,
  username      VARCHAR(60)  NOT NULL,
  name          VARCHAR(120) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'factory',
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  token_version INT NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every ERP record (jobs, paper, sales orders, reels, challans, expenses ...).
-- One row per record; `collection` is the record type and `data` holds the record as JSON,
-- exactly as the app screens read and write it.
CREATE TABLE IF NOT EXISTS documents (
  collection  VARCHAR(64)  NOT NULL,
  id          VARCHAR(191) NOT NULL,
  data        LONGTEXT     NOT NULL,
  m           VARCHAR(64)  NULL COMMENT 'copy of data.m (month key) for fast monthly queries',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by  VARCHAR(40)  NULL,
  updated_by  VARCHAR(40)  NULL,
  PRIMARY KEY (collection, id),
  KEY idx_documents_coll_m (collection, m),
  KEY idx_documents_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Change counter per record type; phones poll this to stay live.
CREATE TABLE IF NOT EXISTS collection_versions (
  collection VARCHAR(64) NOT NULL,
  ver        BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (collection)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Short locks so two phones never take the same PIN / voucher number at once.
CREATE TABLE IF NOT EXISTS leases (
  collection VARCHAR(64)  NOT NULL,
  id         VARCHAR(191) NOT NULL,
  holder     VARCHAR(191) NOT NULL,
  expires_at BIGINT       NOT NULL,
  PRIMARY KEY (collection, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server settings (e.g. the login-token signing secret, generated on first start).
CREATE TABLE IF NOT EXISTS app_settings (
  k VARCHAR(64) NOT NULL,
  v TEXT        NOT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
