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
