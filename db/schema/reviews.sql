CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    reviewer_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,      
    type_id INT NOT NULL,           
    review TEXT NOT NULL,
    ratings INT NOT NULL CHECK (ratings >= 0 AND ratings <= 5),
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

CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
ALTER TABLE reviews
ADD COLUMN status review_status DEFAULT 'pending';
