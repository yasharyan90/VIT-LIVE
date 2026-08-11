package models

import "time"

type User struct {
	ID              string    `json:"id"`
	CollegeEmail    string    `json:"college_email"`
	FullName        string    `json:"full_name"`
	Role            string    `json:"role"`
	DepartmentID    *string   `json:"department_id"`
	DepartmentCode  *string   `json:"department_code"`
	DepartmentName  *string   `json:"department_name"`
	YearOfStudy     *int      `json:"year_of_study"`
	IsVerified      bool      `json:"is_verified"`
	CreatedAt       time.Time `json:"created_at"`
	FollowedClubIDs []string  `json:"followed_club_ids,omitempty"`
}

type Department struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

type Announcement struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	Priority       string    `json:"priority"`
	ImageURL       *string   `json:"image_url"`
	AudienceType   string    `json:"audience_type"`
	AudienceRef    *string   `json:"audience_ref"`
	AuthorName     string    `json:"author_name"`
	CreatedAt      time.Time `json:"created_at"`
	PublishAt      time.Time `json:"publish_at"`
	Scheduled      bool      `json:"scheduled,omitempty"`
	ReactionCount  int       `json:"reaction_count"`
	MyReaction     bool      `json:"my_reaction"`
	DeliveredCount int       `json:"delivered_count,omitempty"`
}

type EmergencyAlert struct {
	ID              string    `json:"id"`
	Message         string    `json:"message"`
	TriggeredByName string    `json:"triggered_by_name"`
	DeliveredCount  int       `json:"delivered_count"`
	TotalTarget     int       `json:"total_target"`
	CreatedAt       time.Time `json:"created_at"`
}

type LostFoundItem struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	ImageURL    *string   `json:"image_url"`
	Location    string    `json:"location"`
	Status      string    `json:"status"`
	PostedBy    string    `json:"posted_by"`
	PosterName  string    `json:"poster_name"`
	PosterEmail string    `json:"poster_email"`
	CreatedAt   time.Time `json:"created_at"`
	ReportCount int       `json:"report_count,omitempty"`
}

type Event struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	BannerURL   *string   `json:"banner_url"`
	Venue       string    `json:"venue"`
	StartTime   time.Time `json:"start_time"`
	ClubID      *string   `json:"club_id"`
	ClubName    *string   `json:"club_name"`
	RSVPCount   int       `json:"rsvp_count"`
	MyRSVP      bool      `json:"my_rsvp"`
	CreatedAt   time.Time `json:"created_at"`
}

type PollOption struct {
	ID         string `json:"id"`
	OptionText string `json:"option_text"`
	Votes      int    `json:"votes"`
}

type Poll struct {
	ID            string       `json:"id"`
	Question      string       `json:"question"`
	AllowMultiple bool         `json:"allow_multiple"`
	ClosesAt      *time.Time   `json:"closes_at"`
	CreatedAt     time.Time    `json:"created_at"`
	TotalVotes    int          `json:"total_votes"`
	HasVoted      bool         `json:"has_voted"`
	IsClosed      bool         `json:"is_closed"`
	Options       []PollOption `json:"options"`
}

type Club struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	MemberCount int    `json:"member_count"`
	IsFollowing bool   `json:"is_following"`
}

type AcademicEvent struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Kind      string    `json:"kind"`
	StartsOn  string    `json:"starts_on"` // YYYY-MM-DD
	EndsOn    *string   `json:"ends_on"`
	CreatedAt time.Time `json:"created_at"`
}

type MessMenu struct {
	MenuDate  string    `json:"menu_date"` // YYYY-MM-DD
	Meal      string    `json:"meal"`
	Items     string    `json:"items"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AuditLog struct {
	ID        string         `json:"id"`
	ActorName string         `json:"actor_name"`
	Action    string         `json:"action"`
	Target    string         `json:"target"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt time.Time      `json:"created_at"`
}
