# Thiết kế chỉnh sửa đề cương theo hướng SRCLA là đóng góp trọng tâm

## Mục tiêu

Chỉnh sửa `De-cuong.docx` để đề cương xác định thuật toán Safe, Robust, Cost-Aware Lending Allocator (SRCLA) là đối tượng nghiên cứu và đóng góp chính. Ví Navy cùng các chức năng thanh toán, merchant, quản trị và AI chỉ đóng vai trò ứng dụng thực nghiệm hỗ trợ kiểm chứng và trình diễn thuật toán.

## Tên đề tài

**Navy – Nghiên cứu và xây dựng thuật toán SRCLA cho phân bổ tài sản ERC-20 trên các giao thức cho vay phi tập trung**

Tên đề tài dẫn bằng hoạt động nghiên cứu và thuật toán SRCLA. Navy được giữ lại để liên kết với sản phẩm hiện thực nhưng không còn được mô tả trước hết như một công cụ quản trị ví.

## Phân cấp nội dung

1. **Trọng tâm nghiên cứu:** bài toán phân bổ tài sản ERC-20 giữa các thị trường cho vay; hạn chế của chiến lược chọn APY cao nhất; mô hình, pipeline, giới hạn an toàn, thực nghiệm và khả năng tái lập của SRCLA.
2. **Hạ tầng kiểm chứng:** vault ERC-4626, strategy adapter, giới hạn trên chuỗi, dịch vụ thu thập dữ liệu, thực thi và đối soát.
3. **Ứng dụng thực nghiệm cho người dùng:** ứng dụng Navy cho phép gửi/rút tài sản, quan sát vị thế và xem giải thích quyết định SRCLA. Thanh toán, chuyển token, merchant, quản trị và AI assistant là chức năng hỗ trợ, không phải đóng góp nghiên cứu độc lập.

## Thay đổi theo từng phần

### 1. Lý do chọn đề tài

Mở đầu trực tiếp bằng khó khăn của phân bổ vốn trong DeFi: APY biến động, tác động của quy mô phân bổ, thanh khoản rút vốn, bất định và chi phí tái cân bằng. Sau đó xác định khoảng trống nghiên cứu và giới thiệu SRCLA. Ứng dụng Navy chỉ được giới thiệu ở cuối phần như môi trường thực nghiệm và trình diễn.

### 2. Mục tiêu

Mục tiêu tổng quát là nghiên cứu, xây dựng và đánh giá SRCLA. Các mục tiêu cụ thể ưu tiên: mô hình hóa bài toán; xây dựng pipeline Safe–Robust–Cost-Aware; áp dụng giới hạn an toàn; xây dựng vault và adapter phục vụ thực thi; thiết kế baseline, ablation, walk-forward và mainnet-fork; đánh giá định lượng và tính tái lập. Các công cụ quản trị ví được gộp vào một mục tiêu cuối mang tên **Ứng dụng thực nghiệm cho người dùng**.

### 3. Phạm vi và đối tượng sử dụng

Tách rõ phạm vi nghiên cứu SRCLA, hạ tầng kiểm chứng và ứng dụng thực nghiệm. Đối tượng nghiên cứu chính là bài toán phân bổ tài sản ERC-20; người dùng, merchant và quản trị viên là các tác nhân của hệ thống minh họa.

### 4. Phương pháp thực hiện

Đặt mô hình thuật toán và phương pháp đánh giá trước phần tích hợp ứng dụng. Nêu rõ biến đầu vào, ràng buộc, mục tiêu tối ưu, pipeline quyết định, cơ chế fail-closed, baseline, ablation, walk-forward, chỉ số đánh giá và mainnet-fork.

### 5. Nền tảng công nghệ

Đặt SRCLA service, dữ liệu, công cụ tối ưu/kiểm thử và smart contract trước công nghệ ứng dụng. Expo, Next.js và các công cụ giao diện được mô tả là nền tảng của ứng dụng thực nghiệm.

### 6. Kết quả mong đợi

Trình bày kết quả nghiên cứu SRCLA trước, gồm pipeline, bộ dữ liệu, kết quả so sánh, chỉ số rủi ro/chi phí/thanh khoản, kiểm tra giả thuyết và gói tái lập. Vault và ứng dụng Navy là kết quả kiểm chứng và minh họa.

### 7. Hướng phát triển và tiến độ

Ưu tiên mở rộng mô hình, dữ liệu, giao thức, quản trị rủi ro và đánh giá SRCLA. Trong tiến độ, các giai đoạn nghiên cứu, phát triển thuật toán và thực nghiệm phải nổi bật hơn giai đoạn tích hợp ứng dụng.

## Quy tắc thuật ngữ

- Dùng **tài sản ERC-20** hoặc **token ERC-20** trong tên đề tài, mục tiêu, lý thuyết thuật toán, phạm vi nghiên cứu và kết quả tổng quát.
- Chỉ nêu **USDC** khi mô tả lựa chọn hiện thực của ứng dụng mẫu; không làm cho SRCLA phụ thuộc về lý thuyết vào USDC.
- Dùng **ứng dụng thực nghiệm cho người dùng** làm nhãn chính cho phần sản phẩm hỗ trợ.
- Dùng nhất quán **SRCLA**, **vault ERC-4626**, **strategy adapter**, **thị trường cho vay phi tập trung**, **tái cân bằng** và **đối soát**.

## Ràng buộc chỉnh sửa

- Bảo toàn biểu mẫu của trường, thông tin giảng viên, sinh viên, mốc thời gian và phần ký tên.
- Không tuyên bố kết quả thực nghiệm chưa có hoặc tính sẵn sàng vận hành với tài sản thật.
- Không thay đổi phạm vi kỹ thuật cốt lõi đã được mô tả trong mã nguồn và tài liệu dự án.
- Giữ văn phong học thuật, rõ đóng góp, không quảng bá sản phẩm.

## Tiêu chí hoàn thành

- Tên đề tài và mục tiêu tổng quát xác định SRCLA là trọng tâm ngay khi đọc.
- Các mục tiêu đầu tiên và phần kết quả mong đợi tập trung vào thuật toán và đánh giá.
- Công cụ ví không còn chiếm ưu thế về thứ tự hoặc số lượng mô tả.
- USDC chỉ xuất hiện trong ngữ cảnh hiện thực ứng dụng mẫu.
- Tệp DOCX mở được, giữ đúng cấu trúc biểu mẫu, không mất nội dung hành chính và không có lỗi định dạng rõ ràng.
