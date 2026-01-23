DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('pending','processing','completed','cancelled','hold','return');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS orders (
  order_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status order_status DEFAULT 'pending',

  line1 VARCHAR(255),
  line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(20),
  phone VARCHAR(20),

  CONSTRAINT fk_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE
);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS total_amount_paise INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS credits_to_grant INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) NOT NULL DEFAULT 'razorpay',
ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(200),
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS credits_granted BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS direct_amount_paise INT,
ADD COLUMN IF NOT EXISTS order_note TEXT;

-- A Razorpay order id should be unique in your system
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_razorpay_order_id
ON orders(razorpay_order_id)
WHERE razorpay_order_id IS NOT NULL;

-- Useful for listing orders by user fast
CREATE INDEX IF NOT EXISTS idx_orders_user_created
ON orders(user_id, created_at DESC);
