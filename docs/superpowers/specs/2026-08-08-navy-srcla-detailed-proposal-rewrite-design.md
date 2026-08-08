# Thiết kế viết lại đề cương chi tiết Navy–SRCLA

**Ngày:** 08/08/2026  
**Tệp nguồn:** `De-cuong-chi-tiet.docx`  
**Tệp đầu ra dự kiến:** `De-cuong-chi-tiet-Navy-SRCLA.docx`

## 1. Mục tiêu tài liệu

Viết lại đề cương chi tiết theo biểu mẫu hành chính hiện có, đồng thời định vị ví blockchain Navy dành cho người dùng là sản phẩm trung tâm và SRCLA là đóng góp kỹ thuật, nghiên cứu chính. Thanh toán QR, chuyển tiền, cổng merchant, quản trị và AI assistant được giữ lại như các chức năng hỗ trợ của hệ sinh thái, không được trình bày ngang hàng với đóng góp SRCLA.

## 2. Tên đề tài

**Navy – Ví blockchain tích hợp farming USDC tối ưu bằng thuật toán SRCLA trên Base**

## 3. Thông tin hành chính

- Đơn vị: Trường Đại học Công nghệ Thông tin – ĐHQG TP.HCM.
- Cán bộ hướng dẫn: ThS. Nguyễn Tấn Toàn.
- Sinh viên: Nguyễn Ngọc Anh Khoa – 23520750.
- Sinh viên: Trương Nguyễn Thùy Anh – 23520082.
- Thời gian thực hiện: 03/09/2026–26/12/2026.
- Giữ bố cục, phần xác nhận và hình thức hành chính của DOCX nguồn; chuẩn hóa lỗi định dạng, thuật ngữ và lịch biểu.

## 4. Định vị đề tài và tỷ trọng nội dung

Đề cương đi từ nhu cầu của người dùng ví: quản lý USDC, thanh toán và đưa tài sản nhàn rỗi vào một cơ chế farming có thể giải thích, kiểm chứng và kiểm soát rủi ro. Khoảng 60% chiều sâu kỹ thuật dành cho farming, ERC-4626, adapter, SRCLA và đánh giá thực nghiệm. Phần còn lại mô tả kiến trúc ví và các chức năng hỗ trợ cần thiết để tạo thành một sản phẩm hoàn chỉnh.

Các tuyên bố phải phân biệt rõ:

- sản phẩm được triển khai và kiểm thử trên Base Sepolia;
- thuật toán được đánh giá bằng dữ liệu Base mainnet và Base mainnet fork;
- kết quả fork không phải bằng chứng về khả năng sinh lời hoặc mức sẵn sàng vận hành tài sản thật trên mainnet;
- kết quả âm hoặc không khác biệt có ý nghĩa thống kê vẫn là kết quả nghiên cứu hợp lệ và phải được báo cáo.

## 5. Định nghĩa SRCLA

**SRCLA (Safe, Robust, Cost-Aware Lending Allocator)** là thuật toán phân bổ vốn vào các giao thức cho vay phi tập trung theo ba nguyên tắc:

- **Safe – An toàn:** chỉ sử dụng thị trường hợp lệ; tuân thủ giới hạn thị trường, mức tập trung, phụ thuộc chung, dự trữ thanh khoản, tổn thất và khả năng rút vốn.
- **Robust – Vững trước biến động:** không xếp hạng theo APY tức thời; mô phỏng lợi suất sau quy mô tiền gửi, dự báo biên lợi suất thấp đã hiệu chỉnh và kiểm tra kịch bản căng thẳng.
- **Cost-Aware – Có xét chi phí:** chỉ tái cân bằng khi lợi ích bảo thủ vượt tổng chi phí gas, phí dữ liệu L1, trượt giá, chuyển đổi phần thưởng và rủi ro đảo chiều.

SRCLA là bộ điều khiển xác định, có thể tái lập và kiểm chứng; không phải tác nhân AI được toàn quyền quản lý tài sản. Luồng quyết định được mô tả thống nhất:

`Thu thập trạng thái → Sàng lọc thị trường → Mô phỏng lợi suất sau phân bổ → Dự báo biên lợi suất thấp → Tính dự trữ thanh khoản → Tối ưu có ràng buộc → Kiểm tra chi phí → Thực thi theo giai đoạn và đối soát`

## 6. Kiến trúc mục tiêu

### 6.1 Ví Navy

Ứng dụng di động dành cho người dùng cuối cung cấp ví nhúng tự quản lý, số dư và lịch sử USDC, quét QR thanh toán, chuyển tiền, gửi/rút farming và theo dõi vị thế vault. Không mô tả ví nhúng như một smart-contract wallet hoặc account-abstraction wallet nếu kiến trúc triển khai không chứng minh điều đó.

### 6.2 Farming vault

`NavyVault` là vault ERC-4626 trên USDC, phát hành share đại diện quyền sở hữu theo tỷ lệ. Hợp đồng trên chuỗi chịu trách nhiệm lưu ký, kế toán và thực thi các giới hạn cứng: adapter được phép, giới hạn tỷ trọng, phụ thuộc chung, dự trữ tối thiểu, mức tổn thất, thời hạn và thứ tự kế hoạch, địa chỉ nhận cố định, tạm dừng và thoát khẩn cấp.

### 6.3 Strategy adapter

Mỗi adapter chỉ tương tác với một thị trường cho vay được duyệt và cô lập cơ chế đặc thù của giao thức. Phạm vi nghiên cứu gồm Aave V3, Compound III và Moonwell. Loại trừ đòn bẩy, vay nợ, bridge, tài sản bất đồng bộ và chiến lược ngoài danh sách nghiên cứu.

### 6.4 Dịch vụ SRCLA độc lập

Dịch vụ TypeScript độc lập sở hữu cơ sở dữ liệu PostgreSQL phục vụ snapshot, dự báo, quyết định, kế hoạch, biên nhận và kết quả đánh giá. Dịch vụ thu thập trạng thái đã finalized, thực hiện pipeline SRCLA, tạo kế hoạch tái cân bằng theo giai đoạn và đối soát theo trạng thái blockchain. Khóa allocator không được phép chuyển tài sản đến địa chỉ tùy ý; hợp đồng là lớp bảo vệ có thẩm quyền cuối cùng.

### 6.5 Chức năng hỗ trợ

Backend NestJS và các ứng dụng web/mobile hỗ trợ xác thực, thanh toán QR, chuyển tiền, đơn hàng, sản phẩm, merchant, webhook, quản trị và AI assistant chỉ đọc hoặc đề xuất thao tác. AI assistant không được tự ý di chuyển tài sản.

## 7. Môi trường triển khai và đánh giá

- Toàn bộ ứng dụng hướng người dùng và hợp đồng thử nghiệm chạy trên Base Sepolia.
- Base Sepolia sử dụng adapter/giao thức thử nghiệm phù hợp để kiểm chứng luồng gửi, rút, thanh toán và tái cân bằng.
- Đánh giá thuật toán sử dụng tối thiểu 12 tháng dữ liệu lịch sử Base mainnet theo thứ tự thời gian.
- Base mainnet fork tái hiện trạng thái Aave V3, Compound III và Moonwell để kiểm tra phép tính, giao dịch, gas, phí, làm tròn và biến động số dư trong điều kiện gần thực tế.
- Không triển khai hoặc cam kết vận hành tiền thật trên Base mainnet trong phạm vi đồ án.

## 8. Phương pháp đánh giá

Đánh giá walk-forward tách dữ liệu hiệu chỉnh và kiểm định, không sử dụng thông tin tương lai. Các chính sách nhận cùng trạng thái quan sát, độ trễ, chi phí, quy mô vốn, tập thị trường và giới hạn an toàn.

Các baseline:

- B0: giữ USDC nhàn rỗi;
- B1: chọn APY hiện tại cao nhất;
- B2: dùng đường cong lợi suất sau tiền gửi nhưng chưa xử lý bất định;
- B3: bổ sung ngưỡng chi phí nhưng chưa có đầy đủ dự trữ động và giới hạn phụ thuộc;
- B4: một phương án phân bổ vững được cố định;
- B5: cận trên biết trước dữ liệu, chỉ dùng chẩn đoán và không được coi là chính sách triển khai được.

Các chỉ số chính gồm lợi suất ròng sau mọi chi phí, tăng trưởng giá trị share, lợi nhuận theo nhóm thời điểm gửi, sai số và độ bao phủ dự báo, mức quay vòng, số lần đảo chiều, chi phí tái cân bằng, drawdown, expected shortfall, mức tập trung, tỷ lệ rút thành công, bao phủ thanh khoản căng thẳng và số vi phạm chính sách.

Không đặt trước một tỷ lệ lợi nhuận tùy ý. Giả thuyết đạt khi SRCLA tạo lợi suất ròng tốt hơn các baseline triển khai được với ý nghĩa thống kê và không vi phạm giới hạn an toàn. Kết quả không vượt baseline hoặc không có ý nghĩa thống kê phải được công bố trung thực.

## 9. Bố cục nội dung DOCX

1. Lý do chọn đề tài.
2. Mục tiêu tổng quát và mục tiêu cụ thể.
3. Phạm vi, chức năng chính/phụ và đối tượng sử dụng.
4. Phương pháp nghiên cứu, thiết kế, triển khai và đánh giá.
5. Nền tảng công nghệ.
6. Kết quả mong đợi theo sản phẩm, nghiên cứu, hiệu năng, an toàn và chất lượng.
7. Hướng phát triển.
8. Kế hoạch thực hiện từ 03/09/2026 đến 26/12/2026.
9. Xác nhận của cán bộ hướng dẫn và sinh viên.

## 10. Yêu cầu chất lượng nội dung

- Dùng tiếng Việt học thuật, chính xác và nhất quán; định nghĩa từ viết tắt ở lần xuất hiện đầu tiên.
- Không dùng các tuyên bố chung chung như “phi tập trung hoàn toàn”, “loại bỏ trung gian”, “an toàn tuyệt đối”, “hoạt động mượt mà” hoặc “tối ưu” nếu không gắn với phương pháp kiểm chứng.
- Không trình bày gasless, account abstraction hoặc AES bảo vệ khóa riêng như đóng góp farming nếu kiến trúc mục tiêu không sử dụng chúng.
- Phân biệt rõ APY hiển thị, lợi suất sau phân bổ và lợi suất ròng sau chi phí.
- Kết quả mong đợi phải đo được và phù hợp với thời lượng đồ án.
- Lịch biểu không chứa ngày sai, không có giai đoạn “bảo trì về sau” ngoài thời gian đồ án và phải gắn mỗi giai đoạn với một sản phẩm bàn giao cụ thể.

## 11. Tiêu chí hoàn tất DOCX

- Tên đề tài, hành chính và thời gian đúng như đã duyệt.
- SRCLA được giải thích rõ bằng tên đầy đủ, ba thuộc tính và pipeline quyết định.
- Ví người dùng là sản phẩm trung tâm; SRCLA là đóng góp kỹ thuật chính.
- Base Sepolia và Base mainnet fork được phân biệt nhất quán trong mọi phần.
- Phạm vi chính/phụ, baseline, dữ liệu 12 tháng và tiêu chí đánh giá xuất hiện đầy đủ.
- Bảng tiến độ phủ đúng 03/09/2026–26/12/2026.
- DOCX mở được, giữ phần ký xác nhận, không còn placeholder hoặc câu văn chưa hoàn thiện.
