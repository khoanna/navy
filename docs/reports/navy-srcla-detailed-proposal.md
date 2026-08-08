# Navy – Ví blockchain tích hợp farming USDC tối ưu bằng thuật toán SRCLA trên Base

**Đơn vị:** Trường Đại học Công nghệ Thông tin – Đại học Quốc gia Thành phố Hồ Chí Minh  
**Cán bộ hướng dẫn:** ThS. Nguyễn Tấn Toàn  
**Sinh viên thực hiện:** Nguyễn Ngọc Anh Khoa – 23520750; Trương Nguyễn Thùy Anh – 23520082  
**Thời gian thực hiện:** Từ ngày 03/09/2026 đến ngày 26/12/2026

## 1. Lý do chọn đề tài

Ví blockchain giúp người dùng trực tiếp quản lý tài sản số và tương tác với các dịch vụ tài chính phi tập trung. Tuy nhiên, trải nghiệm hiện nay còn phân mảnh: người dùng thường phải chuyển đổi giữa ví, ứng dụng thanh toán và nhiều giao thức cho vay để thực hiện các nhu cầu cơ bản như chuyển tiền, thanh toán hoặc khai thác tài sản nhàn rỗi. Quy trình này đòi hỏi kiến thức về mạng blockchain, phí giao dịch, chữ ký và rủi ro hợp đồng thông minh, tạo ra rào cản lớn đối với người dùng phổ thông.

Đối với farming bằng stablecoin, cách lựa chọn giao thức có lợi suất phần trăm hằng năm (Annual Percentage Yield – APY) cao nhất tại một thời điểm không phản ánh đầy đủ lợi ích thực tế. Một khoản gửi có quy mô lớn có thể làm thay đổi mức sử dụng vốn và làm giảm lãi suất sau phân bổ. Lợi thế lợi suất cũng có thể bị triệt tiêu bởi phí gas, phí dữ liệu lớp 1, trượt giá, chi phí chuyển đổi phần thưởng và việc phải tái cân bằng quá thường xuyên. Ngoài ra, giá trị tài sản được ghi nhận không đồng nghĩa với khả năng rút vốn tức thời khi thanh khoản của giao thức suy giảm.

Từ vấn đề trên, đề tài xây dựng Navy như một ví blockchain tập trung vào trải nghiệm người dùng với các chức năng quản lý USDC, thanh toán QR, chuyển tiền và farming trong cùng một ứng dụng. Đóng góp kỹ thuật chính là kiến trúc farming sử dụng vault ERC-4626 và thuật toán **Safe, Robust, Cost-Aware Lending Allocator (SRCLA)** để phân bổ USDC giữa các thị trường cho vay trên Base. Thuật toán không chỉ xem xét lợi suất mà còn mô hình hóa quy mô tiền gửi, bất định, thanh khoản, giới hạn rủi ro và toàn bộ chi phí tái cân bằng.

Đề tài có ý nghĩa ở cả góc độ sản phẩm và nghiên cứu. Về sản phẩm, Navy minh họa cách tích hợp thanh toán và farming vào một ví dễ sử dụng. Về nghiên cứu, đề tài xây dựng một quy trình quyết định xác định, giải thích được và có thể tái lập; sau đó so sánh SRCLA với các chiến lược đơn giản hơn bằng dữ liệu lịch sử và Base mainnet fork. Kết quả được đánh giá theo giả thuyết kiểm định thay vì mặc định rằng thuật toán phức tạp luôn tạo ra hiệu quả cao hơn.

## 2. Mục tiêu

### 2.1. Mục tiêu tổng quát

Nghiên cứu và xây dựng ví blockchain Navy trên Base, tích hợp thanh toán và farming USDC; trong đó kiến trúc vault ERC-4626 và thuật toán SRCLA hỗ trợ phân bổ vốn vào các giao thức cho vay theo mục tiêu tối ưu lợi suất ròng có ràng buộc an toàn, thanh khoản và chi phí.

### 2.2. Mục tiêu cụ thể

- Xây dựng ứng dụng ví dành cho người dùng cuối, hỗ trợ xác thực, quản lý số dư USDC, lịch sử giao dịch, chuyển tiền, quét QR thanh toán, gửi/rút farming và theo dõi vị thế.
- Xây dựng hợp đồng thanh toán và các dịch vụ hỗ trợ merchant trên Base Sepolia để tạo hóa đơn, nhận thanh toán QR, theo dõi trạng thái và đối soát giao dịch.
- Thiết kế `NavyVault` theo ERC-4626 để lưu ký USDC theo mô hình gộp, phát hành share đại diện quyền sở hữu và bảo đảm kế toán công bằng giữa các thời điểm gửi tiền.
- Xây dựng các strategy adapter cô lập cơ chế tương tác với Aave V3, Compound III và Moonwell; không sử dụng đòn bẩy, vay nợ hoặc cầu nối chuỗi trong phạm vi nghiên cứu.
- Xây dựng thuật toán SRCLA gồm sàng lọc thị trường, mô phỏng lợi suất sau phân bổ, dự báo bảo thủ, dự trữ thanh khoản động, tối ưu có ràng buộc, kiểm tra chi phí và thực thi theo giai đoạn.
- Áp đặt các giới hạn an toàn trên hợp đồng thông minh để khóa allocator không thể tự thêm giao thức, hạ giới hạn hoặc chuyển tài sản người dùng đến địa chỉ tùy ý.
- Thu thập tối thiểu 12 tháng dữ liệu Base mainnet, đánh giá theo thời gian bằng phương pháp walk-forward và tái hiện giao dịch trên Base mainnet fork.
- So sánh SRCLA với các baseline B0–B5 trên cùng dữ liệu, độ trễ, chi phí, quy mô vốn và điều kiện an toàn; công bố cả kết quả đạt và không đạt giả thuyết.
- Kiểm thử chức năng, tính đúng đắn kế toán, ràng buộc an toàn, khả năng phục hồi, hiệu năng và tính tái lập của hệ thống.

### 2.3. Giải thích thuật toán SRCLA

**SRCLA (Safe, Robust, Cost-Aware Lending Allocator)** là thuật toán phân bổ vốn vào các giao thức cho vay phi tập trung theo ba nguyên tắc:

- **Safe – An toàn:** chỉ phân bổ vào thị trường vượt qua bước thẩm định trạng thái và cấu hình; đồng thời tuân thủ giới hạn theo thị trường, giới hạn phụ thuộc chung, dự trữ thanh khoản, mức tổn thất và khả năng rút vốn.
- **Robust – Vững trước biến động:** không ra quyết định chỉ từ APY hiện tại. Thuật toán mô phỏng lãi suất sau khi thêm vốn, dùng biên lợi suất thấp được hiệu chỉnh theo dữ liệu quá khứ và kiểm tra các kịch bản căng thẳng.
- **Cost-Aware – Có xét chi phí:** chỉ tái cân bằng khi lợi ích bảo thủ trong kỳ nắm giữ vượt tổng phí gas, phí dữ liệu lớp 1, trượt giá, chi phí đổi phần thưởng và biên an toàn trước rủi ro đảo chiều.

Pipeline quyết định của SRCLA được cố định theo thứ tự:

**Thu thập trạng thái → Sàng lọc thị trường → Mô phỏng lợi suất sau phân bổ → Dự báo biên lợi suất thấp → Tính dự trữ thanh khoản → Tối ưu có ràng buộc → Kiểm tra chi phí → Thực thi theo giai đoạn và đối soát.**

SRCLA là bộ điều khiển xác định và có thể kiểm chứng, không phải mô hình trí tuệ nhân tạo được trao toàn quyền quản lý tiền. Dịch vụ ngoài chuỗi thực hiện mô phỏng, dự báo và tối ưu; vault trên chuỗi nắm giữ tài sản và là lớp có thẩm quyền cuối cùng trong việc kiểm tra giới hạn trước mỗi hành động.

## 3. Phạm vi và đối tượng sử dụng

### 3.1. Phạm vi nền tảng và môi trường

- Ứng dụng di động Navy dành cho người dùng cuối; ứng dụng web dành cho merchant và quản trị viên; backend API và các dịch vụ blockchain liên quan.
- Toàn bộ ứng dụng, hợp đồng thanh toán và hợp đồng farming thử nghiệm được triển khai trên **Base Sepolia**.
- Đánh giá SRCLA sử dụng trạng thái, dữ liệu lịch sử của Base mainnet và **Base mainnet fork**. Môi trường fork dùng để tái hiện phép tính và giao dịch của các giao thức thực mà không vận hành tài sản thật.
- Tài sản nghiên cứu là USDC; farming chỉ gồm vị thế cung cấp vốn trực tiếp, không đòn bẩy, trên Aave V3, Compound III và Moonwell.
- Không thuộc phạm vi: triển khai tiền thật trên Base mainnet, vay nợ, thế chấp, phái sinh, bridge, chiến lược rút vốn bất đồng bộ, bảo đảm lợi nhuận hoặc tuyên bố sẵn sàng sản xuất.

### 3.2. Chức năng chính dành cho người dùng

- Đăng nhập bằng các phương thức do nền tảng ví nhúng hỗ trợ và quản lý ví tự quản lý trong ứng dụng.
- Xem địa chỉ ví, số dư USDC, giá trị farming và lịch sử hoạt động.
- Quét mã QR để xem và xác nhận thanh toán hóa đơn của merchant.
- Gửi USDC đến người nhận sau khi người dùng kiểm tra nội dung và ký giao dịch.
- Gửi USDC vào `NavyVault`, nhận share ERC-4626, theo dõi giá trị quy đổi và rút tài sản trong giới hạn thanh khoản khả dụng.
- Xem lịch sử quyết định SRCLA ở dạng dễ hiểu: thị trường hợp lệ, tỷ trọng mục tiêu, dự trữ, lợi ích dự kiến, chi phí và lý do thực hiện hoặc không thực hiện tái cân bằng.
- Nhận đề xuất từ AI assistant về số dư, thanh toán và farming; mọi thao tác thay đổi tài sản đều phải được người dùng xác nhận và ký.

### 3.3. Kiến trúc farming trọng tâm

- **NavyVault:** vault ERC-4626 gộp USDC, phát hành share, ghi nhận tổng tài sản và thực hiện gửi/rút theo quy tắc làm tròn xác định.
- **Strategy adapter:** hợp đồng riêng cho từng giao thức, chỉ được gửi tài sản đến thị trường đã duyệt và rút tài sản về vault.
- **Giới hạn trên chuỗi:** danh sách adapter, trần phân bổ, giới hạn phụ thuộc chung, mức dự trữ tối thiểu, mức tổn thất tối đa, thời hạn kế hoạch, thứ tự hành động, chống phát lại, tạm dừng và thoát khẩn cấp.
- **Dịch vụ SRCLA độc lập:** thu thập snapshot đã finalized, lưu dữ liệu phiên bản hóa, chạy pipeline quyết định, tạo kế hoạch tái cân bằng và đối soát biên nhận theo trạng thái blockchain.
- **Cơ sở dữ liệu SRCLA:** lưu snapshot, chế độ cấu hình, dự báo, phương án ứng viên, quyết định, chi phí, kế hoạch, giao dịch, kết quả đối soát, baseline và kết quả đánh giá để hỗ trợ tái lập.

### 3.4. Chức năng hỗ trợ

- **Merchant:** đăng ký, cấu hình ví nhận tiền, quản lý sản phẩm, tạo hóa đơn/QR, theo dõi đơn hàng, khóa API, doanh thu và webhook đối soát.
- **Quản trị viên:** xác thực tăng cường, duyệt merchant, quản lý cấu hình hợp đồng, phí nền tảng và giám sát trạng thái hệ thống.
- **Thanh toán:** người dùng kiểm tra hóa đơn, ký dữ liệu giao dịch và theo dõi trạng thái xác nhận trên Base Sepolia.
- **AI assistant:** đọc dữ liệu được cấp quyền và tạo đề xuất có cấu trúc; không nắm khóa allocator và không tự gửi giao dịch chuyển tài sản.

### 3.5. Đối tượng sử dụng

- **Người dùng ví:** cá nhân có nhu cầu quản lý, chuyển, thanh toán và khai thác USDC nhàn rỗi trong một ứng dụng mà không phải trực tiếp thao tác trên nhiều giao thức.
- **Merchant:** cá nhân hoặc đơn vị cần tạo hóa đơn, nhận thanh toán USDC và tích hợp cổng thanh toán vào hệ thống bán hàng.
- **Quản trị viên:** người vận hành, giám sát cấu hình, an toàn, trạng thái dịch vụ và quy trình phê duyệt merchant.
- **Người nghiên cứu/phát triển:** người cần tái lập dữ liệu, baseline, quyết định và kết quả đánh giá SRCLA.

## 4. Phương pháp thực hiện

### 4.1. Nghiên cứu và phân tích

- Nghiên cứu blockchain Base, mô hình tài khoản Ethereum, USDC, ERC-20, ERC-4626, EIP-712, chữ ký số và mô hình relayer phục vụ thanh toán.
- Nghiên cứu cơ chế thị trường cung cấp vốn, đường cong lãi suất, thanh khoản rút vốn và phần thưởng của Aave V3, Compound III và Moonwell.
- Khảo sát các vault và bộ phân bổ vốn hiện có; phân tích khoảng trống giữa chiến lược chọn APY cao nhất với yêu cầu lợi suất ròng, thanh khoản và chi phí thực thi.
- Thu thập yêu cầu của người dùng ví, merchant và quản trị viên; xây dựng use case, luồng nghiệp vụ và tiêu chí chấp nhận.

### 4.2. Thiết kế và phát triển hệ thống

- Thiết kế kiến trúc tách biệt giữa ví, backend, hợp đồng lưu ký, adapter và dịch vụ SRCLA.
- Thiết kế cơ sở dữ liệu, API, mô hình quyền, quy trình ký, đối soát giao dịch và phục hồi sau lỗi.
- Phát triển hợp đồng thông minh theo hướng kiểm thử trước; dùng unit test, fuzz test và invariant test cho kế toán ERC-4626, quyền hạn và giới hạn tài sản.
- Phát triển các mô-đun SRCLA dưới dạng hàm TypeScript xác định, độc lập framework để kiểm thử và tái lập thuận lợi.
- Tích hợp ứng dụng di động với backend và hợp đồng Base Sepolia; giữ mọi hành động thay đổi tài sản sau bước xác nhận của người dùng.

### 4.3. Mô hình thuật toán

Tại mỗi thời điểm quyết định, SRCLA xây dựng snapshot đã finalized và loại các thị trường không đáp ứng yêu cầu cấu hình, trạng thái, thanh khoản hoặc dữ liệu. Với mỗi thị trường hợp lệ, hệ thống mô phỏng đường cong lợi suất sau khi phân bổ một lượng USDC cụ thể thay vì sử dụng APY hiển thị. Mô-đun dự báo tạo biên lợi suất thấp cho kỳ nắm giữ từ dữ liệu quá khứ, không sử dụng thông tin tương lai.

Thuật toán tiếp tục ước lượng nhu cầu rút vốn và các kịch bản căng thẳng để xác định dự trữ USDC nhàn rỗi. Bộ tối ưu lựa chọn tỷ trọng nhằm tối đa hóa lợi suất bảo thủ dự kiến dưới các ràng buộc tổng vốn, trần thị trường, phụ thuộc chung, dự trữ và khả năng rút. Quyết định chỉ chuyển thành kế hoạch khi lợi ích sau chi phí vượt ngưỡng bảo thủ. Kế hoạch rút vốn khỏi vị thế cũ trước, sau đó mới phân bổ sang vị thế mới; trạng thái được đọc lại và đối soát sau mỗi giao dịch.

### 4.4. Thiết kế thực nghiệm

- Thu thập tối thiểu 12 tháng dữ liệu theo thứ tự thời gian; lưu block, timestamp, trạng thái giao thức, thanh khoản, lãi suất, phần thưởng, oracle, phí gas và cờ chất lượng dữ liệu.
- Sử dụng walk-forward evaluation với các ranh giới hiệu chỉnh và kiểm định được cố định trước; loại bỏ look-ahead bias và tách các giai đoạn có thay đổi cấu hình giao thức.
- Đánh giá nhiều mức quy mô vault để quan sát tác động của dung lượng thị trường và chi phí lên quyết định.
- Khôi phục cùng trạng thái Base mainnet fork trước khi chạy từng chính sách đối chứng; áp dụng cùng dữ liệu đầu vào, độ trễ, chi phí, tập thị trường và giới hạn an toàn.

Các baseline được đăng ký trước:

- **B0:** giữ USDC nhàn rỗi trong vault.
- **B1:** chọn thị trường hợp lệ có APY hiện tại cao nhất.
- **B2:** sử dụng đường cong lợi suất sau tiền gửi nhưng chưa xử lý bất định.
- **B3:** bổ sung ngưỡng chi phí di chuyển vào B2 nhưng chưa có đầy đủ dự trữ động và giới hạn phụ thuộc.
- **B4:** sử dụng một phương án phân bổ vững được hiệu chỉnh và cố định trên tập thị trường hợp lệ.
- **B5:** cận trên biết trước dữ liệu tương lai, chỉ dùng để chẩn đoán và không được xem là chính sách có thể triển khai.

Chỉ số dự báo gồm độ lệch, MAE, RMSE, pinball loss, độ bao phủ và độ sắc của biên thấp. Chỉ số bộ điều khiển gồm lợi suất ròng, tăng trưởng giá trị share, lợi nhuận theo nhóm thời điểm gửi, phí gas và dữ liệu lớp 1, chi phí swap, mức quay vòng, số lần đảo chiều, drawdown, expected shortfall, tỷ lệ rút thành công, bao phủ thanh khoản căng thẳng, tài sản tạm không khả dụng, mức tập trung phụ thuộc và số lần vi phạm chính sách.

Giả thuyết nghiên cứu không gắn với một tỷ lệ lợi nhuận đặt trước. SRCLA chỉ được xem là chứng minh được giá trị khi có lợi suất ròng tốt hơn các baseline có thể triển khai với ý nghĩa thống kê và không vi phạm ràng buộc an toàn. Nếu kết quả thấp hơn hoặc không khác biệt có ý nghĩa, báo cáo phải kết luận giả thuyết chưa được chấp nhận thay vì điều chỉnh lại theo dữ liệu kiểm định.

### 4.5. Kiểm thử và đánh giá chất lượng

- Unit test cho logic ví, thanh toán, dự báo, dự trữ, tối ưu, chi phí và quyết định.
- Foundry unit/fuzz/invariant test cho ERC-4626, quyền hạn, trần phân bổ, dự trữ, tổn thất, thứ tự kế hoạch và chống chuyển tài sản sai đích.
- Integration test trên Base Sepolia cho đăng nhập, thanh toán QR, gửi/rút farming và lịch sử giao dịch.
- Base mainnet fork test cho công thức giao thức, gas, phí, làm tròn, thay đổi số dư và đối soát biên nhận.
- Kiểm thử hiệu năng API trong điều kiện kiểm soát; tách thời gian phản hồi hệ thống ngoài chuỗi khỏi thời gian xác nhận blockchain.
- Lưu manifest dữ liệu, phiên bản chính sách, commit mã nguồn và hash kết quả để kiểm tra tính tái lập.

## 5. Nền tảng công nghệ

- **Ứng dụng di động:** Expo, React Native, TypeScript và Privy cho trải nghiệm ví nhúng.
- **Ứng dụng web:** Next.js và React cho cổng merchant và quản trị viên.
- **Backend API:** NestJS, TypeScript, Prisma và PostgreSQL.
- **Dịch vụ SRCLA:** Node.js, TypeScript, PostgreSQL, bộ lập lịch và API lịch sử chỉ đọc.
- **Hợp đồng thông minh:** Solidity, OpenZeppelin, ERC-20, ERC-4626 và Foundry.
- **Tương tác blockchain:** Base Sepolia, Base mainnet fork, ethers và RPC hỗ trợ dữ liệu archive.
- **Kiểm thử và triển khai:** Jest, Foundry, Anvil, Docker và GitHub.
- **Thiết kế giao diện:** Figma.
- **Môi trường phát triển:** Visual Studio Code.

## 6. Kết quả mong đợi

### 6.1. Kết quả sản phẩm

- Ứng dụng ví Navy hoạt động trên Base Sepolia, cho phép người dùng quản lý USDC, xem lịch sử, chuyển tiền, quét QR thanh toán và thao tác farming trong một luồng thống nhất.
- Cổng merchant tạo và theo dõi hóa đơn; cổng quản trị hỗ trợ quy trình phê duyệt và giám sát cơ bản.
- `NavyVault` ERC-4626 và các adapter thử nghiệm thực hiện đúng luồng gửi, phát hành share, phân bổ, thu hồi vốn và rút tài sản.
- Người dùng xem được vị thế farming và thông tin giải thích quyết định SRCLA mà không trao quyền tự động chuyển tiền cho AI assistant.

### 6.2. Kết quả nghiên cứu

- Hoàn thiện pipeline SRCLA xác định, có phiên bản chính sách, lý do quyết định và hash dữ liệu để tái lập.
- Xây dựng bộ dữ liệu tối thiểu 12 tháng, bộ baseline B0–B5, quy trình walk-forward và các kịch bản Base mainnet fork.
- Có báo cáo định lượng về dự báo, lợi suất ròng, chi phí, mức quay vòng, rủi ro, thanh khoản và vi phạm chính sách theo từng quy mô vault.
- Kết luận giả thuyết dựa trên ý nghĩa thống kê và giới hạn an toàn; báo cáo trung thực kết quả âm hoặc không phân biệt được với baseline.

### 6.3. Kết quả an toàn và chất lượng

- Không xuất hiện vi phạm giới hạn an toàn trong bộ thực nghiệm đã đăng ký; mọi lỗi dữ liệu, mô phỏng hoặc đối soát dẫn đến trạng thái không thực thi.
- Các invariant chứng minh allocator không thể chuyển tài sản đến địa chỉ tùy ý, thêm adapter hoặc hạ giới hạn bằng quyền của chính nó.
- Các luồng hợp lệ trên Base Sepolia và Base mainnet fork có biên nhận, sự kiện và thay đổi số dư được đối soát.
- API ngoài chuỗi đạt thời gian phản hồi p95 dưới 3 giây trong kịch bản tải đã công bố; thời gian xác nhận blockchain được đo và báo cáo riêng.
- Môi trường, dữ liệu, cấu hình, mã nguồn và kết quả đánh giá có hướng dẫn tái lập.

### 6.4. Sản phẩm bàn giao

- Mã nguồn ứng dụng di động, ứng dụng web, backend, hợp đồng thông minh và dịch vụ SRCLA.
- Tài liệu phân tích yêu cầu, kiến trúc, cơ sở dữ liệu, hợp đồng, thuật toán và API.
- Bộ kiểm thử tự động, kịch bản Base Sepolia, Base mainnet fork và báo cáo kết quả.
- Báo cáo đồ án, tài liệu cài đặt, hướng dẫn sử dụng và video minh họa sản phẩm.

## 7. Hướng phát triển

### 7.1. Hoàn thiện trước khi vận hành tài sản thật

- Thực hiện kiểm toán độc lập cho vault, adapter, bộ thực thi phần thưởng và quy trình vận hành.
- Chuyển quyền quản trị sang multisig kết hợp timelock; tách quyền guardian và lưu khóa allocator trong phần cứng hoặc dịch vụ quản lý khóa chuyên dụng.
- Sử dụng nhiều RPC độc lập, cơ chế giám sát, cảnh báo, giới hạn canary, kế hoạch ứng phó sự cố và chương trình bug bounty.
- Kiểm tra lại toàn bộ giả thuyết và tham số trên dữ liệu mới trước mọi quyết định triển khai giới hạn trên Base mainnet.

### 7.2. Mở rộng nghiên cứu và sản phẩm

- Bổ sung giao thức hoặc thị trường mới thông qua adapter bất biến và một quy trình đánh giá đăng ký trước riêng biệt.
- Nghiên cứu mô hình dự báo và tối ưu khác, nhưng giữ lớp giới hạn trên chuỗi và so sánh công bằng với SRCLA xác định.
- Mở rộng phân tích nhu cầu rút vốn, rủi ro phụ thuộc chung, thay đổi chế độ thị trường và cơ chế chuyển đổi phần thưởng.
- Cải thiện trải nghiệm giải thích quyết định, cảnh báo rủi ro, khôi phục ví và khả năng tiếp cận của ứng dụng.
- Phát triển SDK và tiện ích tích hợp thanh toán Navy cho các nền tảng thương mại điện tử sau khi hoàn thiện đánh giá an toàn.

## 8. Kế hoạch thực hiện

| Giai đoạn | Thời gian | Công việc | Kết quả |
|---|---|---|---|
| 1. Khảo sát và xác định yêu cầu | 03/09/2026–10/09/2026 | Khảo sát giải pháp ví, thanh toán và farming; xác định use case, phạm vi, tiêu chí chấp nhận và rủi ro. | Tài liệu yêu cầu, use case, phạm vi và tiêu chí đánh giá. |
| 2. Nghiên cứu SRCLA và dữ liệu | 11/09/2026–20/09/2026 | Nghiên cứu ERC-4626, Aave V3, Compound III, Moonwell, mô hình lãi suất, chi phí, thanh khoản và phương pháp walk-forward. | Cơ sở lý thuyết, mô hình thuật toán, danh mục nguồn dữ liệu và baseline. |
| 3. Thiết kế kiến trúc | 21/09/2026–30/09/2026 | Thiết kế kiến trúc ví, backend, hợp đồng, adapter, dịch vụ SRCLA, cơ sở dữ liệu, quyền hạn và luồng đối soát. | Sơ đồ kiến trúc, thiết kế dữ liệu, API, hợp đồng và giao diện. |
| 4. Phát triển hợp đồng | 01/10/2026–18/10/2026 | Xây dựng hợp đồng thanh toán, NavyVault, adapter, giới hạn an toàn và bộ Foundry test. | Hợp đồng biên dịch được; unit, fuzz và invariant test cốt lõi đạt. |
| 5. Phát triển dịch vụ SRCLA | 19/10/2026–31/10/2026 | Xây dựng collector, admission, simulator, forecast, reserve, optimizer, cost gate, executor và persistence. | Pipeline SRCLA xác định, có kiểm thử, decision record và API lịch sử. |
| 6. Tích hợp ví và chức năng hỗ trợ | 01/11/2026–12/11/2026 | Tích hợp ví Base Sepolia, thanh toán QR, chuyển USDC, farming, merchant, admin và AI assistant đề xuất. | Luồng người dùng và chức năng hỗ trợ hoạt động trên môi trường thử nghiệm. |
| 7. Thu thập dữ liệu và thực nghiệm | 13/11/2026–30/11/2026 | Hoàn thiện dữ liệu tối thiểu 12 tháng; chạy walk-forward, B0–B5, ablation và Base mainnet fork theo manifest cố định. | Bộ dữ liệu, kết quả baseline, kết quả SRCLA và log fork có thể tái lập. |
| 8. Kiểm thử và phân tích | 01/12/2026–12/12/2026 | Kiểm thử tích hợp, hiệu năng, bảo mật, phục hồi; phân tích thống kê, giới hạn và các trường hợp thất bại. | Báo cáo kiểm thử, bảng chỉ số, phân tích giả thuyết và hạn chế nghiên cứu. |
| 9. Hoàn thiện và bàn giao | 13/12/2026–26/12/2026 | Hoàn thiện triển khai Base Sepolia, tài liệu, báo cáo, video demo, slide và kịch bản bảo vệ. | Sản phẩm hoàn chỉnh, báo cáo đồ án và bộ tài liệu bàn giao. |

## 9. Xác nhận

**Cán bộ hướng dẫn:** ThS. Nguyễn Tấn Toàn  
**Địa điểm, ngày lập đề cương:** TP. Hồ Chí Minh, ngày 08 tháng 08 năm 2026  
**Sinh viên 1:** Nguyễn Ngọc Anh Khoa  
**Sinh viên 2:** Trương Nguyễn Thùy Anh
