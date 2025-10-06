DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'review_status') THEN
        CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    reviewer_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,      
    type_id INT NOT NULL,           
    review TEXT NOT NULL,
    ratings INT NOT NULL CHECK (ratings >= 0 AND ratings <= 5),
    status review_status DEFAULT 'pending', 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reviewer
        FOREIGN KEY (reviewer_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS review_metadata (
    id SERIAL PRIMARY KEY,
    review_id INT NOT NULL,
    meta_key VARCHAR(100) NOT NULL,
    meta_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_review
        FOREIGN KEY (review_id)
        REFERENCES reviews (id)
        ON DELETE CASCADE
);
